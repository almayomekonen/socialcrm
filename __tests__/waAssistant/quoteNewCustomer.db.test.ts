import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A quote for a customer who is not a lead yet, against a real (local test)
 * PostgreSQL: webhook handler → worker → the application's own lead search →
 * one question or a card → a tap → the REAL Action Runtime, `create_quote`
 * executor, `createLeadForOwner` and `createQuoteSystem` → the owner's PDF
 * preview. Only the model, the renderer, R2 and Meta are stood in for; `fetch`
 * is stubbed, so nothing leaves this machine. Same harness as
 * quoteDelivery.db.test.ts.
 *
 * NOTE: over the 250-line soft limit on purpose, like its siblings: one flat
 * list of independent scenarios over one shared harness.
 */
const h = vi.hoisted(() => ({ agent: true, jobs: [] as (() => Promise<void>)[], pdfSeq: 0, quoteThrows: false }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => h.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
// A crash INSIDE the quote write, after the lead insert in the same transaction.
vi.mock('@/db/quotes/createQuote', async (orig) => {
  const real = await orig<typeof import('@/db/quotes/createQuote')>()
  return {
    ...real,
    createQuoteSystem: async (input: Parameters<typeof real.createQuoteSystem>[0]) => {
      if (h.quoteThrows) throw new Error('quote write crashed')
      return real.createQuoteSystem(input)
    },
  }
})
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (job: () => Promise<void>) => void h.jobs.push(job) }))
vi.mock('@/lib/pdf/renderer', async (orig) => ({ ...(await orig<typeof import('@/lib/pdf/renderer')>()), renderPdfFromHtml: async () => new Uint8Array([37, 80, 68, 70, ++h.pdfSeq]) }))
vi.mock('@/lib/storage/objects', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/objects')>()),
  putObject: async () => undefined,
  headObject: async () => ({ size: 5 }),
  presignDownload: async (i: { key: string }) => `https://r2.test/${i.key}?sig=1`,
}))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { QUOTE_COPY } from '@/lib/waAssistant/quotes/copy'
import { COPY } from '@/lib/waAssistant/render'
import { createQuoteAction, quoteLeadSource } from '@/lib/agent/actions/domain/createQuote'
import { createLeadForOwner } from '@/lib/system/createLeadForOwner'
import { groundedProposal } from '@/lib/agent/proposalGate'
import { createQuoteProposal } from '@/lib/agent/waActionSchemas'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { findActionByActionId } from '@/db/agentActions'
import { newCustomerRule } from '@/lib/waAssistant/leadChoice'
import { FREE_LEAD_LIMIT } from '@/lib/quota/constants'
import type { ProposedAction } from '@/lib/agent/types'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0
const NOW = () => Math.floor(Date.now() / 1000)

// ── Meta ──────────────────────────────────────────────────────────────────────
type Call = { url: string; body: any }
let calls: Call[] = []
const ok = () => new Response(JSON.stringify({ messages: [{ id: `wamid.HBgM_nc_${++seq}` }] }), { status: 200 })
const platform = () => calls.filter((c) => c.url.includes(`/${PLATFORM}/`) && c.body?.messaging_product && !c.body?.status)
const lastOwner = () => platform().at(-1)!.body
const ownerText = () => (lastOwner().text?.body ?? lastOwner().interactive?.body?.text) as string
/** Anything addressed to a number other than the owners' own. */
const notToOwners = (owners: string[]) => calls.filter((c) => c.body?.messaging_product && c.body?.to && !owners.includes(c.body.to))
const buttonsOf = (body: any) => body.interactive.action.buttons.map((b: any) => b.reply.id) as string[]

// ── Owners and leads ──────────────────────────────────────────────────────────
type Owner = { u: number; digits: string }
async function owner(agencyId = A, role = 'ADMIN'): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000079${String(++seq).padStart(2, '0')}`
  await recipient(agencyId, u, digits, undefined, 'v4')
  return { u, digits }
}
async function existingLead(agencyId: number, userId: number, firstName: string, lastName: string, phone: string | null = null) {
  const [c] = await db('clients').insert({ firstName, lastName, phone, agencyId, userId, createdById: userId, lead: true, status: 'new' }).returning('id')
  return Number(c.id)
}
const leadsOf = (agencyId: number) => db('clients').where({ agencyId }).orderBy('id').select('id', 'firstName', 'lastName', 'phone', 'email', 'userId', 'handlerId', 'createdById', 'createOrigin', 'leadSource', 'lead', 'status', 'overQuota')
const quotesOf = (agencyId: number) => db('sales_quotes').where({ agencyId }).orderBy('id').select('id', 'leadId', 'status', 'totalAmount', 'automationKey')
const deliveriesOf = (agencyId: number) => db('sales_quote_deliveries').where({ agencyId })

const say = (o: Owner, body: string) => processPlatformMessage({ id: `wamid.__nc_${++seq}`, from: o.digits, timestamp: String(NOW()), type: 'text', text: { body } } as never)
const tapRaw = (digits: string, id: string) => processPlatformMessage({ id: `wamid.__nc_${++seq}`, from: digits, timestamp: String(NOW()), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } } as never)

const results: Record<string, unknown>[] = []
const agentInputs: { verifiedLeadIds?: number[]; surfaceRules?: string }[] = []
const worker = () =>
  runWaAssistantWorker({}, {
    runAgent: (async (i: { verifiedLeadIds?: number[]; surfaceRules?: string }) => {
      agentInputs.push(i)
      return results.shift()
    }) as never,
    typing: (async () => undefined) as never,
  })
const turn = async (o: Owner, text: string, answer: Record<string, unknown>) => {
  results.push(answer)
  await say(o, text)
  await worker()
}
const tap = async (o: Owner, id: string) => {
  await tapRaw(o.digits, id)
  await worker()
}
const drain = async () => {
  while (h.jobs.length) await h.jobs.shift()!()
}

type Customer = { firstName: string | null; lastName: string | null; phone: string | null; email: string | null }
const nobody: Customer = { firstName: null, lastName: null, phone: null, email: null }
const LINES = [{ title: 'צילום אירוע', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }]
/** What the Agent answers when find_lead found nobody: clientId 0 and the customer as the owner wrote them, no lead evidence. */
const forNewCustomer = (newCustomer: Customer | null, over: Record<string, unknown> = {}) => ({
  ok: true,
  answer: {
    headline: 'h',
    claims: [],
    unknown: null,
    proposedAction: { actionType: 'create_quote', args: { clientId: 0, newCustomer, title: 'צילום אירוע', lines: LINES, priceBasis: 'incl_vat', validityDays: null, ...over }, evidenceRefs: [] },
  },
  evidence: [],
  steps: 2,
  stopReason: 'answered',
  investigationId: `inv_nc_${++seq}`,
  costUsd: 0.01,
})

beforeAll(async () => {
  A = await agency('__nc_a__')
  B = await agency('__nc_b__')
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id IN (?, ?)`, [A, B])
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).del()
  for (const agencyId of [A, B]) await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions', 'agent_requests']) await db(t).del().catch(() => undefined)
  await db('sales_quotes').whereIn('agencyId', [A, B]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).update({ ratePercent: 18 })
  await db('agencies').whereIn('id', [A, B]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  h.agent = true
  h.jobs.length = 0
  h.quoteThrows = false
  results.length = 0
  agentInputs.length = 0
  calls = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) })
    return ok()
  })
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS = `${A},${B}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  vi.unstubAllGlobals()
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']) delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions', 'agent_requests']) await db(t).del().catch(() => undefined)
  await db('sales_quotes').whereIn('agencyId', [A, B]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B]).del()
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).del()
  await db('analytics_events').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

const REQUEST = 'תכין הצעת מחיר לדנה לוי 052-7654321 על צילום אירוע, 18,500 שקל כולל מע"מ'

describe('a new customer with a name and a phone', () => {
  it('a card that creates the lead; nothing before the tap; one lead, linked to the quote; the owner gets the PDF and the customer nothing', async () => {
    const o = await owner()
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))

    const card = ownerText()
    expect(card).toContain('*ליצור ליד והצעת מחיר?*')
    expect(card).toContain('ליד חדש: דנה לוי, טלפון שמסתיים ב-4321')
    expect(card).toContain('הליד ייווצר ב-SocialCRM יחד עם ההצעה, רק אחרי האישור.')
    expect(card).toContain('*סה"כ: ₪18,500.00*')
    // Never "under what name is the customer saved?": the card came straight away.
    expect(card).not.toContain('שמור')
    expect(await leadsOf(A)).toHaveLength(0)
    expect(await quotesOf(A)).toHaveLength(0)

    await tap(o, buttonsOf(lastOwner())[0])
    await drain()

    const leads = await leadsOf(A)
    expect(leads).toHaveLength(1)
    const [action] = await db('agent_actions').where({ agencyId: A, actionType: 'create_quote' })
    expect(leads[0]).toMatchObject({
      firstName: 'דנה',
      lastName: 'לוי',
      phone: '972527654321',
      email: null,
      userId: o.u,
      handlerId: o.u,
      createdById: o.u,
      createOrigin: 'manual',
      leadSource: quoteLeadSource(action.actionId),
      lead: true,
      status: 'new',
      overQuota: false,
    })
    // The quote is on EXACTLY the lead the approval created.
    const quotes = await quotesOf(A)
    expect(quotes).toHaveLength(1)
    expect(Number(quotes[0].leadId)).toBe(Number(leads[0].id))
    expect(quotes[0].status).toBe('ready')
    const stored = await findActionByActionId(A, action.actionId)
    expect(stored!.args).toMatchObject({ clientId: 0, newLead: { firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null } })
    // The new lead's id is persisted on the workflow (the tap's message) and in the action's targets.
    const tapJob = await db('wa_assistant_jobs').whereNotNull('leadChoice').orderBy('id', 'desc').first('leadChoice')
    expect(tapJob.leadChoice).toEqual({ leadId: Number(leads[0].id) })
    const [audited] = await db('agent_actions').where({ agencyId: A, actionId: action.actionId }).select('targetIds', 'verificationState')
    expect(audited.verificationState).toBe('VERIFIED')
    expect(audited.targetIds).toEqual(expect.arrayContaining([{ kind: 'lead', id: String(leads[0].id) }, { kind: 'quote', id: String(quotes[0].id) }]))

    // The real preview: the PDF reaches the owner, with the send card; the customer has nothing.
    // The real preview: the PDF file itself reaches the owner; the customer has nothing.
    const preview = platform().at(-1)!.body
    expect(preview).toMatchObject({ to: o.digits, type: 'document' })
    expect(preview.document.link).toContain('https://r2.test/tenants/')
    expect(preview.document.filename).toMatch(/^Quote-00001-.+\.pdf$/)
    expect(preview.document.caption).toContain('זו תצוגה מקדימה בשבילך בלבד. הלקוח עדיין לא קיבל את ההצעה.')
    expect(preview.document.caption).toContain('ליד: דנה לוי')
    expect(notToOwners([o.digits])).toHaveLength(0)
    expect(await deliveriesOf(A)).toHaveLength(0)
  })

  it('a retried execution of the approved action finds the same lead and the same quote', async () => {
    const o = await owner()
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    await tap(o, buttonsOf(lastOwner())[0])
    const [row] = await db('agent_actions').where({ agencyId: A, actionType: 'create_quote' })
    const action = await findActionByActionId(A, row.actionId)
    const ctx = { actor: { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 10_000 }
    const again = await createQuoteAction.execute({ ...(action as object), actionId: row.actionId, args: action!.args } as never, ctx as never)
    expect(again).toMatchObject({ status: 'SUCCESS', detail: { created: false, leadCreated: false } })
    expect(await leadsOf(A)).toHaveLength(1)
    expect(await quotesOf(A)).toHaveLength(1)
  })

  it('the model\'s details are kept only when the owner wrote them', async () => {
    const o = await owner()
    // The model "remembered" a last name and a phone the owner never wrote.
    await turn(o, 'תכין הצעת מחיר לדנה על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ firstName: 'דנה', lastName: 'כהן', phone: '050-1112233', email: 'x@y.co' }))
    expect(ownerText()).toContain('ליד חדש: דנה')
    expect(ownerText()).not.toContain('כהן')
    expect(ownerText()).not.toContain('טלפון שמסתיים')
    await tap(o, buttonsOf(lastOwner())[0])
    expect((await leadsOf(A))[0]).toMatchObject({ firstName: 'דנה', lastName: '', phone: null, email: null })
  })
})

describe('partial information: only what is missing is asked, once', () => {
  it('only a phone → the name, and nothing else; the answer is used as the name, and the phone is not asked again', async () => {
    const o = await owner()
    await turn(o, 'תכין הצעת מחיר ל-052-7654321 על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ ...nobody, phone: '052-7654321' }))
    expect(ownerText()).toBe(QUOTE_COPY.askNewCustomerNameKnownContact)
    expect(await leadsOf(A)).toHaveLength(0)

    // The answer is a bare name. The model, told this is a new customer, proposes again without a name.
    await turn(o, 'דנה לוי', forNewCustomer({ ...nobody, phone: '052-7654321' }))
    expect(agentInputs.at(-1)!.surfaceRules).toContain(newCustomerRule)
    expect(agentInputs.at(-1)!.verifiedLeadIds).toBeUndefined()
    const card = ownerText()
    expect(card).toContain('ליד חדש: דנה לוי, טלפון שמסתיים ב-4321')
    expect(card).not.toContain('טלפון?')

    await tap(o, buttonsOf(lastOwner())[0])
    expect(await leadsOf(A)).toMatchObject([{ firstName: 'דנה', lastName: 'לוי', phone: '972527654321' }])
  })

  it('a name alone is enough: no phone or email is asked for', async () => {
    const o = await owner()
    await turn(o, 'תכין הצעת מחיר לדנה לוי על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: null, email: null }))
    expect(ownerText()).toContain('ליד חדש: דנה לוי')
    expect(buttonsOf(lastOwner())).toHaveLength(2)
  })

  it('the next missing quote detail (VAT) keeps the new customer: no second question about who', async () => {
    const o = await owner()
    await turn(o, 'תכין הצעת מחיר לדנה לוי 052-7654321 על צילום אירוע, 18,500 שקל', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }, { priceBasis: null }))
    expect(ownerText()).toBe(QUOTE_COPY.askVat)
    // Told the customer is new, the model passes no details this time.
    await turn(o, 'כולל מע"מ', forNewCustomer(null))
    expect(agentInputs.at(-1)!.surfaceRules).toContain(newCustomerRule)
    expect(ownerText()).toContain('ליד חדש: דנה לוי, טלפון שמסתיים ב-4321')
  })

  it('no customer at all → one question about who, never about a saved lead name', async () => {
    const o = await owner()
    await turn(o, 'תכין הצעת מחיר על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer(null))
    expect(ownerText()).toBe(QUOTE_COPY.askLead)
    expect(QUOTE_COPY.askLead).not.toContain('שמור')
  })
})

describe('an existing customer is reused, never duplicated', () => {
  it('the phone is already a lead (stored as 05…) → that lead, and no lead is created', async () => {
    const o = await owner()
    const dana = await existingLead(A, o.u, 'דנה', 'לוי', '0527654321')
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    expect(ownerText()).toContain('ליד: דנה לוי')
    expect(ownerText()).not.toContain('ליד חדש')
    await tap(o, buttonsOf(lastOwner())[0])
    expect(await leadsOf(A)).toHaveLength(1)
    expect(Number((await quotesOf(A))[0].leadId)).toBe(dana)
  })

  it('the same email → that lead', async () => {
    const o = await owner()
    const dana = await existingLead(A, o.u, 'דנה', 'לוי')
    await db('clients').where({ id: dana }).update({ email: 'dana@example.com' })
    await turn(o, 'תכין הצעת מחיר ללקוחה dana@example.com על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ ...nobody, email: 'Dana@Example.com' }))
    expect(ownerText()).toContain('ליד: דנה לוי')
    await tap(o, buttonsOf(lastOwner())[0])
    expect(Number((await quotesOf(A))[0].leadId)).toBe(dana)
    expect(await leadsOf(A)).toHaveLength(1)
  })
})

describe('several possible leads: the owner chooses', () => {
  it('two leads with the name → a list ending in "a new lead"; "2" picks the second; nothing is created', async () => {
    const o = await owner()
    await existingLead(A, o.u, 'דנה', 'לוי', '0501111111')
    const second = await existingLead(A, o.u, 'דנה', 'לוי', '0502222222')
    await turn(o, 'תכין הצעת מחיר לדנה לוי על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: null, email: null }))
    const list = ownerText()
    expect(list).toContain('יש 2 לידים בשם דנה לוי:')
    expect(list).toContain('1. דנה לוי, טלפון שמסתיים ב-1111')
    expect(list).toContain('2. דנה לוי, טלפון שמסתיים ב-2222')
    expect(list).toContain('3. ליד חדש')
    expect(await leadsOf(A)).toHaveLength(2)

    await turn(o, '2', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: null, email: null }))
    expect(agentInputs.at(-1)!.verifiedLeadIds).toEqual([second])
    expect(ownerText()).toContain('ליד: דנה לוי')
    await tap(o, buttonsOf(lastOwner())[0])
    expect(Number((await quotesOf(A))[0].leadId)).toBe(second)
    expect(await leadsOf(A)).toHaveLength(2)
  })

  it('"ליד חדש" to the same list → a new lead with the details already given, nothing asked again', async () => {
    const o = await owner()
    await existingLead(A, o.u, 'דנה', 'לוי')
    await turn(o, 'תכין הצעת מחיר לדנה לוי 052-7654321 על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    expect(ownerText()).toContain('2. ליד חדש')
    await turn(o, 'ליד חדש', forNewCustomer(null))
    expect(ownerText()).toContain('ליד חדש: דנה לוי, טלפון שמסתיים ב-4321')
    await tap(o, buttonsOf(lastOwner())[0])
    const leads = await leadsOf(A)
    expect(leads).toHaveLength(2)
    expect(Number((await quotesOf(A))[0].leadId)).toBe(Number(leads[1].id))
  })

  it('the Agent proposed one of two same-name leads it found: the list still ends in "a new lead", and that answer keeps the name and the phone', async () => {
    const o = await owner()
    const first = await existingLead(A, o.u, 'דוד', 'כהן', '0501111111')
    const second = await existingLead(A, o.u, 'דוד', 'לוי', '0502222222')
    const found = (proposed: number) => ({
      ...forNewCustomer(null, { clientId: proposed }),
      evidence: [first, second].map((id) => ({ kind: 'lead', refId: String(id) })),
    })
    await turn(o, 'תכין הצעת מחיר לדוד 052-7654321 על צילום אירוע, 18,500 שקל כולל מע"מ', found(first))
    expect(ownerText()).toContain('3. ליד חדש')
    await turn(o, 'ליד חדש', forNewCustomer(null))
    expect(ownerText()).toContain('ליד חדש: דוד, טלפון שמסתיים ב-4321')
    await tap(o, buttonsOf(lastOwner())[0])
    const leads = await leadsOf(A)
    expect(leads).toHaveLength(3)
    expect(leads[2]).toMatchObject({ firstName: 'דוד', phone: '972527654321' })
    expect(Number((await quotesOf(A))[0].leadId)).toBe(Number(leads[2].id))
  })

  it('an unclear answer gets the same list again, and creates nothing', async () => {
    const o = await owner()
    await existingLead(A, o.u, 'דנה', 'לוי')
    await turn(o, 'תכין הצעת מחיר לדנה לוי על צילום אירוע, 18,500 שקל כולל מע"מ', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: null, email: null }))
    const list = ownerText()
    await turn(o, 'לא יודע', forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: null, email: null }))
    expect(ownerText()).toBe(list)
    expect(await leadsOf(A)).toHaveLength(1)
  })
})

describe('tenancy and visibility', () => {
  it("another agency's lead with the same phone is neither matched nor revealed nor touched; the lead is created in the owner's agency", async () => {
    const o = await owner(A)
    const other = await owner(B)
    const theirs = await existingLead(B, other.u, 'דנה', 'לוי', '0527654321')
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    expect(ownerText()).toContain('ליד חדש: דנה לוי')
    await tap(o, buttonsOf(lastOwner())[0])
    const mine = await leadsOf(A)
    expect(mine).toHaveLength(1)
    expect(Number((await quotesOf(A))[0].leadId)).toBe(Number(mine[0].id))
    expect(await leadsOf(B)).toMatchObject([{ id: theirs, firstName: 'דנה' }])
    expect(await quotesOf(B)).toHaveLength(0)
  })

  it("another agency's owner cannot decide, and so cannot execute, this action: no lead anywhere", async () => {
    const o = await owner(A)
    const other = await owner(B)
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    const [row] = await db('agent_actions').where({ agencyId: A, actionType: 'create_quote' })
    const decided = await decideOnAction({ actionId: row.actionId, argsHash: row.argsHash, decision: 'APPROVED', scope: { agencyId: B, userId: other.u, role: 'ADMIN', gotPermIds: [] } as never, nowMs: Date.now() })
    expect(decided.ok).toBe(false)
    // And the card's button, tapped from agency B's number, is not theirs.
    await tap(other, buttonsOf(lastOwner())[0])
    expect(await leadsOf(A)).toHaveLength(0)
    expect(await leadsOf(B)).toHaveLength(0)
  })

  it("a rep: a phone on another rep's lead is refused without revealing it; nothing is created", async () => {
    const admin = await owner(A, 'ADMIN')
    const rep = await owner(A, 'AGNT')
    await existingLead(A, admin.u, 'דנה', 'לוי', '0527654321')
    await turn(rep, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    expect(ownerText()).toBe(QUOTE_COPY.contactNotVisible)
    expect(await leadsOf(A)).toHaveLength(1)
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(0)
  })

  it('the executor takes the agency only from the actor: the arguments carry none', async () => {
    const o = await owner(A)
    const ctx = { actor: { agencyId: B, userId: o.u, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 10_000 }
    const args = { clientId: 0, newLead: { firstName: 'דנה', lastName: 'לוי', phone: null, email: null }, agencyId: A, title: 'צילום אירוע', lines: [{ title: 'x', quantity: 1, unitAmount: 100, discountAmount: null }], priceBasis: 'incl_vat', validityDays: null, expectedTotalAmount: 100, expectedRatePercent: 18 }
    await createQuoteAction.execute({ actionId: `act_nc_${++seq}`, actionType: 'create_quote', args } as never, ctx as never)
    expect(await leadsOf(A)).toHaveLength(0)
  })
})

describe('the lead service and the gate', () => {
  it('createLeadForOwner refuses past the free limit, and refuses a phone already on a lead', async () => {
    const o = await owner(A)
    const base = { agencyId: A, userId: o.u, firstName: 'דנה', lastName: 'לוי', email: null }
    await existingLead(A, o.u, 'רון', 'כץ', '0527654321')
    expect(await createLeadForOwner({ ...base, phone: '+972 52-765-4321', leadSource: `__nc_t_${++seq}` })).toEqual({ ok: false, reason: 'contact_taken' })

    await db('agencies').where({ id: A }).update({ plan: 'free', trialStartedAt: new Date(Date.now() - 30 * 864e5), trialEndsAt: new Date(Date.now() - 20 * 864e5) })
    const rows = Array.from({ length: FREE_LEAD_LIMIT }, (_, i) => ({ firstName: `ל${i}`, lastName: 'x', agencyId: A, userId: o.u, createdById: o.u, lead: true, status: 'new', overQuota: false }))
    await db('clients').insert(rows)
    expect(await createLeadForOwner({ ...base, phone: null, leadSource: `__nc_t_${++seq}` })).toEqual({ ok: false, reason: 'quota_exceeded' })
  })

  it('the proposal gate passes clientId 0 for a quote (the application decides), never an unread id', () => {
    const none = { has: () => false } as never
    const proposal = (clientId: number) => ({ actionType: 'create_quote', args: { clientId, newCustomer: { firstName: 'דנה', lastName: null, phone: null, email: null }, title: 't', lines: [], priceBasis: null, validityDays: null }, evidenceRefs: [] }) as unknown as ProposedAction
    expect(groundedProposal(proposal(0), none)).not.toBeNull()
    expect(groundedProposal(proposal(99), none)).toBeNull()
    expect(groundedProposal({ actionType: 'create_task', args: { clientId: 0 }, evidenceRefs: [] } as never, none)).toBeNull()
    expect(createQuoteProposal.safeParse(proposal(0)).success).toBe(true)
  })
})

describe('the lead and its quote are one unit', () => {
  const newLeadCard = async (o: Owner) => {
    await turn(o, REQUEST, forNewCustomer({ firstName: 'דנה', lastName: 'לוי', phone: '052-7654321', email: null }))
    return buttonsOf(lastOwner())[0]
  }
  const actionOf = async () => {
    const [row] = await db('agent_actions').where({ agencyId: A, actionType: 'create_quote' })
    return { row, action: (await findActionByActionId(A, row.actionId))! }
  }
  const executeAgain = async (o: Owner) => {
    const { row, action } = await actionOf()
    const ctx = { actor: { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 10_000 }
    return createQuoteAction.execute({ ...(action as object), actionId: row.actionId, args: action.args } as never, ctx as never)
  }
  /** Nothing of the new customer is left: no lead, no quote, no number, and no lead-created job for it. */
  const nothingLeft = async () => {
    expect(await leadsOf(A)).toHaveLength(0)
    expect(await quotesOf(A)).toHaveLength(0)
    expect(await db('bill_numbering_sequences').where({ agencyId: A })).toHaveLength(0)
    expect(await db('automation_jobs').where({ agencyId: A })).toHaveLength(0)
    expect(await db('notification_jobs').where({ agencyId: A }).catch(() => [])).toHaveLength(0)
  }

  it('the quote refused AFTER the lead was inserted (VAT rate changed since the card) rolls the lead back; a retry then makes both, once', async () => {
    const o = await owner()
    const approve = await newLeadCard(o)
    await db('bill_tax_rates').where({ agencyId: A }).update({ ratePercent: 17 })
    await tap(o, approve)
    expect(ownerText()).toBe(QUOTE_COPY.newLeadStaleTotals)
    await nothingLeft()
    expect((await actionOf()).row.executionStatus).toBe('FAILED')

    // The same approved action, run again once the rate is back: one lead, one quote, on that lead.
    await db('bill_tax_rates').where({ agencyId: A }).update({ ratePercent: 18 })
    expect(await executeAgain(o)).toMatchObject({ status: 'SUCCESS', detail: { created: true, leadCreated: true } })
    expect(await executeAgain(o)).toMatchObject({ status: 'SUCCESS', detail: { created: false, leadCreated: false } })
    const leads = await leadsOf(A)
    expect(leads).toHaveLength(1)
    expect((await quotesOf(A)).map((q) => Number(q.leadId))).toEqual([Number(leads[0].id)])
  })

  it('a crash inside the quote write leaves no lead; the runtime does not report success; a retry makes both, once', async () => {
    const o = await owner()
    const approve = await newLeadCard(o)
    h.quoteThrows = true
    await tap(o, approve)
    expect(ownerText()).not.toContain('נוצרה')
    await nothingLeft()
    expect((await actionOf()).row.executionStatus).not.toBe('SUCCESS')

    h.quoteThrows = false
    expect(await executeAgain(o)).toMatchObject({ status: 'SUCCESS', detail: { leadCreated: true } })
    expect(await executeAgain(o)).toMatchObject({ status: 'SUCCESS', detail: { created: false, leadCreated: false } })
    expect(await leadsOf(A)).toHaveLength(1)
    expect(await quotesOf(A)).toHaveLength(1)
  })

  it('the workspace lapsed to the free plan, over its lead limit, between the card and the tap: stopped at the tap; the executor itself refuses too; nothing written', async () => {
    const o = await owner()
    const approve = await newLeadCard(o)
    await db('agencies').where({ id: A }).update({ plan: 'free', trialStartedAt: new Date(Date.now() - 30 * 864e5), trialEndsAt: new Date(Date.now() - 20 * 864e5) })
    await db('clients').insert(Array.from({ length: FREE_LEAD_LIMIT }, (_, i) => ({ firstName: `ל${i}`, lastName: 'x', agencyId: A, userId: o.u, createdById: o.u, lead: true, status: 'new', overQuota: false })))
    await tap(o, approve)
    // No product access, no assistant: the action is never executed.
    expect(ownerText()).toContain('העוזר אינו זמין כרגע לחשבון הזה')
    expect((await actionOf()).row.executionStatus).not.toBe('SUCCESS')
    // The executor's own quota check, should anything reach it: refused, and the transaction leaves nothing.
    expect(await executeAgain(o)).toEqual({ status: 'FAILED', reason: 'lead-quota-exceeded' })
    expect(await leadsOf(A)).toHaveLength(FREE_LEAD_LIMIT)
    expect(await quotesOf(A)).toHaveLength(0)
  })
})
