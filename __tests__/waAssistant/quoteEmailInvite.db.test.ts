import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Smart delivery's third path: an approved quote that WhatsApp cannot reach now
 * goes out as an EMAIL INVITATION to write on WhatsApp, and the quote itself only
 * after the customer writes. Real (local test) PostgreSQL, the real webhook
 * handler, worker, card, Action Runtime, claim and inbound ingest. Stood in: the
 * model, the PDF renderer, R2, Meta (`fetch`) and the email transport. Nothing
 * leaves this machine.
 *
 * NOTE: over the 250-line soft limit on purpose, like quoteDelivery.db.test.ts:
 * one flat list of independent scenarios over one shared harness.
 */
const h = vi.hoisted(() => ({
  jobs: [] as (() => Promise<void>)[],
  pdfSeq: 0,
  emails: [] as { from: string; replyTo: string; to: string; subject: string; html: string; text: string; headers?: Record<string, string>; idempotencyKey?: string }[],
  emailResult: (() => ({ ok: true as const, id: 'email_1' })) as () => { ok: true; id: string } | { ok: false; error: string },
  enqueues: 0,
  analyses: 0,
}))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => true }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (job: () => Promise<void>) => void h.jobs.push(job) }))
vi.mock('@/lib/pdf/renderer', async (orig) => ({ ...(await orig<typeof import('@/lib/pdf/renderer')>()), renderPdfFromHtml: async () => new Uint8Array([37, 80, 68, 70, ++h.pdfSeq]) }))
vi.mock('@/lib/storage/objects', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/objects')>()),
  putObject: async () => undefined,
  headObject: async () => ({ size: 5 }),
  presignDownload: async (i: { key: string }) => `https://r2.test/${i.key}?sig=1`,
}))
vi.mock('@/lib/email/sender', () => ({
  sendEmail: async (a: (typeof h.emails)[number]) => {
    h.emails.push(a)
    return h.emailResult()
  },
}))
vi.mock('@/lib/inbox/autoresponse/enqueueInboundAutoResponse', async (orig) => {
  const real = await orig<typeof import('@/lib/inbox/autoresponse/enqueueInboundAutoResponse')>()
  return {
    ...real,
    enqueueInboundAutoResponse: (...a: Parameters<typeof real.enqueueInboundAutoResponse>) => {
      h.enqueues++
      return real.enqueueInboundAutoResponse(...a)
    },
  }
})

vi.mock('@/db/conversationIntelligence', async (orig) => {
  const real = await orig<typeof import('@/db/conversationIntelligence')>()
  return {
    ...real,
    enqueueConversationAnalysis: (...a: Parameters<typeof real.enqueueConversationAnalysis>) => {
      h.analyses++
      return real.enqueueConversationAnalysis(...a)
    },
  }
})

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { handleInboundWebhookMessage } from '@/lib/whatsapp/handleInboundWebhookMessage'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { DELIVERY_COPY, INVITE_REFUSAL_COPY } from '@/lib/waAssistant/quotes/deliveryCopy'
import { QUOTE_DELIVERY_TEMPLATE } from '@/lib/waAssistant/quotes/customerSend'
import { editQuoteSystem } from '@/db/quotes/editQuote'
import { cancelQuoteSystem } from '@/db/quotes/cancelQuote'
import { hashInvitationRef, invitationPrefill, invitationRefIn, newInvitationRef, whatsappClickToChat } from '@/lib/quotes/invitationRef'
import { emailHashOf } from '@/lib/waAssistant/quotes/emailInvite'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0
const NOW = () => Math.floor(Date.now() / 1000)
const pn = (agencyId: number) => `__qi_pn_${agencyId}`
const DISPLAY = '+972 3-555-0101'
const LEAD_EMAIL = 'David.Cohen@Example.test'

// ── Meta ──────────────────────────────────────────────────────────────────────
type Call = { url: string; body: any }
let calls: Call[] = []
const ok = () => new Response(JSON.stringify({ messages: [{ id: `wamid.HBgM_${++seq}` }] }), { status: 200 })
const platform = () => calls.filter((c) => c.url.includes(`/${PLATFORM}/`) && c.body?.messaging_product && !c.body?.status)
const customer = () => calls.filter((c) => c.url.includes('/__qi_pn_') && c.body?.messaging_product)
const lastOwner = () => platform().at(-1)!.body
const ownerText = () => (lastOwner().text?.body ?? lastOwner().interactive?.body?.text) as string
const previews = () => platform().filter((c) => c.body.interactive?.header?.type === 'document')
const buttonsOf = (body: any) => body.interactive.action.buttons.map((b: any) => b.reply.id) as string[]

type Owner = { u: number; digits: string; lead: number; waId: string }
/** One owner, one lead whose WhatsApp window is CLOSED (no inbound ever), one connected business number. */
async function owner(agencyId = A, opts: { role?: string; email?: string | null; inboundAgoMs?: number | null } = {}): Promise<Owner> {
  const u = await user(agencyId, opts.role ?? 'ADMIN')
  const digits = `9725000077${String(++seq).padStart(2, '0')}`
  await recipient(agencyId, u, digits, undefined, 'v4')
  const waId = `97253${String(1000000 + ++seq)}`
  const email = opts.email === undefined ? LEAD_EMAIL : opts.email
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: `0${waId.slice(3)}`, email, agencyId, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  const lead = Number(c.id)
  if (!(await db('whatsapp_connections').where({ agency_id: agencyId }).first('id'))) await db('whatsapp_connections').insert({ user_id: u, agency_id: agencyId, phone_number_id: pn(agencyId), access_token: 'x' })
  const inbound = opts.inboundAgoMs === undefined ? null : opts.inboundAgoMs
  await db('inbox_conversations').insert({ agencyId, leadId: lead, channel: 'whatsapp', businessPhoneNumberId: pn(agencyId), customerWaId: waId, lastInboundAt: inbound == null ? null : new Date(Date.now() - inbound) })
  return { u, digits, lead, waId }
}

const say = (o: { digits: string }, body: string) => processPlatformMessage({ id: `wamid.__qi_${++seq}`, from: o.digits, timestamp: String(NOW()), type: 'text', text: { body } } as never)
const tapRaw = (digits: string, id: string) => processPlatformMessage({ id: `wamid.__qi_${++seq}`, from: digits, timestamp: String(NOW()), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } } as never)

const results: Record<string, unknown>[] = []
const worker = () => runWaAssistantWorker({}, { runAgent: (async () => results.shift()) as never, typing: (async () => undefined) as never })
const tap = async (o: { digits: string }, id: string) => {
  await tapRaw(o.digits, id)
  await worker()
}
const drain = async () => {
  while (h.jobs.length) await h.jobs.shift()!()
}
const createQuote = (lead: number) => ({
  ok: true,
  answer: {
    headline: 'h',
    claims: [],
    unknown: null,
    proposedAction: { actionType: 'create_quote', args: { clientId: lead, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${lead}`] },
  },
  evidence: [{ kind: 'lead', refId: String(lead) }],
  steps: 2,
  stopReason: 'answered',
  investigationId: `inv_qi_${++seq}`,
  costUsd: 0.01,
})

async function reviewing(o: Owner) {
  results.push(createQuote(o.lead))
  await say(o, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ')
  await worker()
  await tap(o, buttonsOf(lastOwner())[0])
  await drain()
  const q = await db('sales_quotes').where({ leadId: o.lead }).first('id')
  const card = previews().at(-1)?.body
  return { quoteId: Number(q.id), card, buttons: card ? (buttonsOf(card) as string[]) : [] }
}
/** Reviewed and approved: the email invitation has gone out. */
async function invited(o: Owner) {
  const r = await reviewing(o)
  await tap(o, r.buttons[0])
  return r
}

/** The wa.me link from the email, and the message it pre-fills. */
function invitationOf(i = 0) {
  const link = /https:\/\/wa\.me\/(\d+)\?text=([^\s"<]+)/.exec(h.emails[i].text)!
  return { number: link[1], prefill: decodeURIComponent(link[2]) }
}
/** The customer pressing Send in WhatsApp: the real customer-webhook handler, for one message. */
const customerWrites = (o: Owner, body: string, opts: { agencyId?: number; from?: string; id?: string } = {}) => {
  const agencyId = opts.agencyId ?? A
  return handleInboundWebhookMessage({
    message: { id: opts.id ?? `wamid.__qi_c_${++seq}`, from: opts.from ?? o.waId, timestamp: String(NOW()), type: 'text', text: { body } },
    phoneNumberId: pn(agencyId),
    profileName: 'דוד',
    connection: { agency_id: agencyId, user_id: o.u },
  })
}

const quoteRow = (id: number) => db('sales_quotes').where({ id }).first('status', 'version', 'sentAt')
const deliveries = (quoteId: number) => db('sales_quote_deliveries').where({ quoteId }).orderBy('id')
const invitations = (quoteId: number) => db('sales_quote_invitations').where({ quoteId }).orderBy('id')
const eventsOf = async (quoteId: number) => (await db('sales_quote_events').where({ quoteId }).orderBy('id').select('type')).map((e) => e.type as string)

beforeAll(async () => {
  A = await agency('__qi_a__')
  B = await agency('__qi_b__')
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id IN (?, ?)`, [A, B])
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).del()
  for (const agencyId of [A, B]) {
    await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
    // The first admin is the reply-to of the business's customer email (getAgencyReplyTo).
    await user(agencyId, 'ADMIN', { email: `owner-${agencyId}@biz.test`, suspended: false })
  }
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions', 'agent_requests', 'whatsapp_opt_out_events']) await db(t).del().catch(() => undefined)
  await db('whatsapp_opt_outs').whereIn('agencyId', [A, B]).del().catch(() => undefined)
  await db('whatsapp_templates').whereIn('agencyId', [A, B]).del()
  await db('sales_quotes').whereIn('agencyId', [A, B]).del()
  await db('inbox_conversations').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B]).del()
  await db('automation_email_blocks').whereIn('agencyId', [A, B]).del().catch(() => undefined)
  await db('automation_lead_suppressions').whereIn('agencyId', [A, B]).del().catch(() => undefined)
  await db('agencies').whereIn('id', [A, B]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  h.jobs.length = 0
  h.emails.length = 0
  h.emailResult = () => ({ ok: true, id: `email_${++seq}` })
  h.enqueues = 0
  h.analyses = 0
  results.length = 0
  calls = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const u = String(url)
    // The business's own number, read from Meta by its phone_number_id (lib/whatsapp/businessDisplayNumber.ts).
    if (u.includes('fields=id,display_phone_number')) {
      const id = decodeURIComponent(/graph\.facebook\.com\/[^/]+\/([^?]+)/.exec(u)![1])
      return new Response(JSON.stringify({ id, display_phone_number: DISPLAY }), { status: 200 })
    }
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? 'null')) })
    return ok()
  })
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_QUOTES_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS = `${A},${B}`
  process.env.AUTOMATIONS_FROM = 'quotes@mail.test'
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B}`
  // Contacts on: an inbound number keeps the lead its conversation remembers (handleInboundWebhookMessage).
  process.env.WA_CONTACTS_ENABLED = '1'
  process.env.WA_CONTACTS_AGENCY_ALLOWLIST = `${A},${B}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
const ENV = ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS', 'WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS', 'AUTOMATIONS_FROM', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'WA_CONTACTS_ENABLED', 'WA_CONTACTS_AGENCY_ALLOWLIST', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']
afterAll(async () => {
  vi.unstubAllGlobals()
  for (const k of ENV) delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions', 'agent_requests']) await db(t).del()
  await db('whatsapp_templates').whereIn('agencyId', [A, B]).del()
  await db('sales_quotes').whereIn('agencyId', [A, B]).del()
  await db('inbox_conversations').whereIn('agencyId', [A, B]).del()
  await db('whatsapp_connections').whereIn('agency_id', [A, B]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B]).del()
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).del()
  await db('analytics_events').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('the delivery order: WhatsApp first, email only when WhatsApp cannot', () => {
  it('1. window open: the quote goes out as WhatsApp text, and no email is sent', async () => {
    const o = await owner(A, { inboundAgoMs: 60_000 })
    const { quoteId, buttons, card } = await reviewing(o)
    expect(card.interactive.body.text).not.toContain('מייל')
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(1)
    expect((await deliveries(quoteId))[0]).toMatchObject({ channel: 'text', state: 'accepted' })
    expect(h.emails).toHaveLength(0)
    expect(await invitations(quoteId)).toHaveLength(0)
  })

  it('2. window closed with an approved template: the template, and no email', async () => {
    const o = await owner()
    await db('whatsapp_templates').insert({ agencyId: A, wabaId: 'w', name: QUOTE_DELIVERY_TEMPLATE, displayTitle: 'q', language: 'he', category: 'UTILITY', status: 'approved', bodyText: 'שלום {{1}}, הצעה {{2}} מ-{{3}}: {{4}}' })
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])
    expect(customer()[0].body.type).toBe('template')
    expect((await deliveries(quoteId))[0]).toMatchObject({ channel: 'template', state: 'accepted' })
    expect(h.emails).toHaveLength(0)
  })

  it('3. neither: the card offers an email invitation, and approving it sends ONE email and no quote', async () => {
    const o = await owner()
    const { quoteId, card, buttons } = await reviewing(o)
    const body = card.interactive.body.text as string
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['approve', 'edit', 'cancel'])
    expect(body).toContain('d***@example.test')
    expect(body).toContain('ההצעה עצמה תישלח אליו בוואטסאפ, בדיוק כפי שהיא, רק אחרי שיכתוב לעסק.')
    expect(body).not.toContain('קישור לקובץ המצורף')

    await tap(o, buttons[0])
    expect(h.emails).toHaveLength(1)
    const inv0 = (await invitations(quoteId))[0]
    expect(h.emails[0].idempotencyKey).toBe(`quote-invite/${A}/${inv0.id}`)
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
    expect(await quoteRow(quoteId)).toMatchObject({ status: 'ready', sentAt: null })
    const [inv] = await invitations(quoteId)
    expect(inv).toMatchObject({ state: 'sent', quoteVersion: 1, customerPhoneE164: `+${o.waId}`, emailHash: emailHashOf(LEAD_EMAIL), approvedByUserId: o.u })
    expect(ownerText()).toContain('נשלחה לליד הזמנה במייל. ההצעה עדיין לא נשלחה ללקוח.')
    expect(ownerText()).not.toContain('הצעת המחיר נשלחה ללקוח')
    expect(await eventsOf(quoteId)).toContain('invite_sent')
  })

  it('4. the email carries a wa.me link with an opaque reference, and nothing about the quote', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    const e = h.emails[0]
    const q = await db('sales_quotes').where({ id: quoteId }).first('quoteNumber', 'totalAmount')
    expect(e.to).toBe(LEAD_EMAIL.toLowerCase())
    expect(e.replyTo).toBe(`owner-${A}@biz.test`)
    expect(e.headers?.['List-Unsubscribe']).toContain('/api/automations/unsubscribe')
    const { number, prefill } = invitationOf()
    expect(number).toBe('97235550101')
    const ref = invitationRefIn(prefill)!
    expect(prefill).toBe(invitationPrefill(ref))
    const [inv] = await invitations(quoteId)
    expect(inv.refHash).toBe(hashInvitationRef(ref))
    expect(JSON.stringify(inv)).not.toContain(ref)
    for (const text of [e.subject, e.text, e.html, prefill]) {
      expect(text).not.toContain('₪')
      expect(text).not.toContain('r2.test')
      expect(text).not.toContain('/api/q')
      expect(text).not.toContain(String(Number(q.totalAmount)))
      expect(text).not.toContain(Number(q.totalAmount).toLocaleString('en-US'))
    }
    // No number at all outside the two links (the only CRM ids are in the signed unsubscribe link every
    // customer email carries, lib/automations), and the reference is the only token in the message.
    for (const text of [e.subject, e.text.replace(/https?:\/\/\S+/g, ''), prefill.replace(ref, '')]) expect(text).not.toMatch(/\d/)
  })

  it('5. no email address: no send button, the exact reason, and nothing sent', async () => {
    const o = await owner(A, { email: null })
    const { card, buttons } = await reviewing(o)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
    expect(card.interactive.body.text).toContain(DELIVERY_COPY.windowClosedNoEmail)
    expect(h.emails).toHaveLength(0)
    expect(customer()).toHaveLength(0)
  })

  it('6. an address that hard-bounced is no address: the same as none', async () => {
    const o = await owner()
    await db('automation_email_blocks').insert({ agencyId: A, emailNormalized: LEAD_EMAIL.toLowerCase(), reason: 'hard_bounce' })
    const { buttons } = await reviewing(o)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
  })
})

describe('the email itself', () => {
  it('7. a failed email: the owner hears it, the quote is untouched, and a new approval may try again', async () => {
    const o = await owner()
    h.emailResult = () => ({ ok: false, error: 'rejected' })
    const { quoteId, buttons } = await invited(o)
    expect(ownerText()).toContain(DELIVERY_COPY.inviteFailed)
    expect((await invitations(quoteId))[0]).toMatchObject({ state: 'failed', failureCode: 'email_rejected' })
    expect(await quoteRow(quoteId)).toMatchObject({ status: 'ready' })
    expect(buttons).toHaveLength(3)

    h.emailResult = () => ({ ok: true, id: 'email_retry' })
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    await drain()
    await tap(o, buttonsOf(previews().at(-1)!.body)[0])
    expect(h.emails).toHaveLength(2)
    expect((await invitations(quoteId)).map((i) => i.state)).toEqual(['failed', 'sent'])
  })

  it('8. a double tap, and a second approval of the same version, never email twice', async () => {
    const o = await owner()
    const { quoteId, buttons } = await invited(o)
    await tap(o, buttons[0])
    expect(h.emails).toHaveLength(1)

    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    await drain()
    await tap(o, buttonsOf(previews().at(-1)!.body)[0])
    expect(h.emails).toHaveLength(1)
    expect(ownerText()).toContain(DELIVERY_COPY.inviteAlready)
    expect(await invitations(quoteId)).toHaveLength(1)
  })

  it('9. an email edited between the preview and the tap: nothing is sent to either address', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await db('clients').where({ id: o.lead }).update({ email: 'someone.else@example.test' })
    await tap(o, buttons[0])
    expect(h.emails).toHaveLength(0)
    expect(ownerText()).toContain(DELIVERY_COPY.inviteEmailChanged)
    expect(await invitations(quoteId)).toHaveLength(0)
  })
})

describe('the customer writes on WhatsApp', () => {
  it('10. pressing Send on the pre-filled message delivers the approved quote once, on WhatsApp', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    expect(customer()).toHaveLength(0)
    const before = await db('agent_requests').where({ agencyId: A }).count('id as n').first()

    const r = await customerWrites(o, invitationOf().prefill)
    expect(r.persisted).toBe(true)
    expect(h.enqueues).toBe(0) // the customer-facing autoresponder stays out of this message
    expect(h.analyses).toBe(0) // and so does the Copilot analysis: no AI runs on it at all

    expect(customer()).toHaveLength(1)
    const sent = customer()[0].body
    expect(sent.to).toBe(o.waId)
    expect(sent.text.body).toMatch(/https:\/\/getsocialcrm\.com\/api\/q#[A-Za-z0-9_-]{43}/)

    const approval = await db('wa_assistant_approvals').where({ agencyId: A, status: 'approved' }).orderBy('id', 'desc').first('actionId')
    const [d] = await deliveries(quoteId)
    expect(d).toMatchObject({ state: 'accepted', channel: 'text', actionId: approval.actionId, approvedByUserId: o.u, quoteVersion: 1 })
    const [inv] = await invitations(quoteId)
    expect(inv).toMatchObject({ state: 'redeemed', deliveryId: d.id })
    expect(await quoteRow(quoteId)).toMatchObject({ status: 'sent' })
    expect(ownerText()).toContain('הלקוח כתב בוואטסאפ, והצעת המחיר נשלחה אליו')
    expect(await eventsOf(quoteId)).toEqual(expect.arrayContaining(['invite_sent', 'invite_redeemed', 'send_accepted']))
    // No model ran and nothing was charged for the reply.
    expect(await db('agent_requests').where({ agencyId: A }).count('id as n').first()).toEqual(before)
  })

  it('11. the same message redelivered, or sent again, never sends the quote twice', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    const { prefill } = invitationOf()
    await customerWrites(o, prefill, { id: 'wamid.__qi_same' })
    await customerWrites(o, prefill, { id: 'wamid.__qi_same' })
    await customerWrites(o, prefill)
    expect(customer()).toHaveLength(1)
    expect(await deliveries(quoteId)).toHaveLength(1)
  })

  it('12. an unknown reference, or the right one from another number, opens nothing', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    await customerWrites(o, invitationPrefill(newInvitationRef()))
    await customerWrites(o, invitationOf().prefill, { from: `97254${String(1000000 + ++seq)}` })
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('sent')
    expect(h.enqueues).toBe(2) // ordinary messages: the autoresponder sees them as always
  })

  it('13. another agency cannot redeem it, even on its own business number', async () => {
    const o = await owner()
    const ob = await owner(B)
    const { quoteId } = await invited(o)
    await customerWrites(ob, invitationOf().prefill, { agencyId: B, from: o.waId })
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('sent')
  })

  it('14. a quote edited after the invitation is not sent; the owner is told why, and the invitation dies', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    const edited = await editQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, title: 'שיפוץ', lines: [{ title: 'שיפוץ', description: '', quantity: 1, unitPrice: 1000, discount: 0 }], validityDays: null, expectedTotalAmount: 1180, expectedRatePercent: 18, actionId: 'act_qi_edit', actorUserId: o.u, visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, nowMs: Date.now() })
    expect(edited.ok).toBe(true)
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
    expect((await invitations(quoteId))[0]).toMatchObject({ state: 'invalidated' })
    expect(ownerText()).toContain(INVITE_REFUSAL_COPY.changed)
  })

  it('15. a cancelled quote is not sent', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    const r = await cancelQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, actorUserId: o.u, actionId: 'act_qi_cancel', visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] } })
    expect(r.ok).toBe(true)
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('invalidated')
  })

  it('16. an expired authorization is not used, and the owner is asked for a new approval', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    await db('sales_quote_invitations').where({ quoteId }).update({ authorizationExpiresAt: new Date(Date.now() - 1000) })
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0]).toMatchObject({ state: 'invalidated', invalidReason: 'authorization_expired' })
    expect(ownerText()).toContain(INVITE_REFUSAL_COPY.expired)
    expect(ownerText()).toContain('תראה לי שוב את ההצעה')
  })

  it('17. an approver who may no longer send quotes: their old approval sends nothing', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    await db('users').where({ id: o.u }).update({ role: 'AGNT' })
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0]).toMatchObject({ state: 'invalidated' })
  })

  it('18b. a reply whose conversation now belongs to another lead is not sent to it, and the owner hears why', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    const [other] = await db('clients').insert({ firstName: 'אחר', lastName: '', agencyId: A, userId: o.u, createdById: o.u, lead: true, status: 'new' }).returning('id')
    await db('inbox_conversations').where({ agencyId: A, customerWaId: o.waId }).update({ leadId: Number(other.id) })
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('invalidated')
    expect(ownerText()).toContain(INVITE_REFUSAL_COPY.not_linked)
  })

  it('18. with the invitation switch off, the card is exactly the old one: no email offered, the old sentence', async () => {
    delete process.env.WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS
    const o = await owner()
    const { card, buttons } = await reviewing(o)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
    expect(card.interactive.body.text).toContain(DELIVERY_COPY.windowClosed)
    expect(card.interactive.body.text).not.toContain('מייל')
  })
})

describe('security review', () => {
  it('20. at most 3 invitation emails to one address per business per day, across quotes and versions', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    const doc = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id', 'contentHash')
    for (const v of [97, 98, 99])
      await db('sales_quote_invitations').insert({ agencyId: A, quoteId, quoteVersion: v, documentId: doc.id, contentHash: doc.contentHash, totalAmount: 1, actionId: `act_qi_cap_${v}`, leadId: o.lead, customerPhoneE164: `+${o.waId}`, businessPhoneNumberId: pn(A), emailHash: emailHashOf(LEAD_EMAIL), refHash: `cap${v}`, state: 'sent', authorizationExpiresAt: new Date(Date.now() + 3600_000) })
    await tap(o, buttons[0])
    expect(h.emails).toHaveLength(0)
    expect(ownerText()).toContain(DELIVERY_COPY.inviteRateLimited)
    // A failed email does not count against the cap.
    await db('sales_quote_invitations').where({ actionId: 'act_qi_cap_97' }).update({ state: 'failed' })
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    await drain()
    await tap(o, buttonsOf(previews().at(-1)!.body)[0])
    expect(h.emails).toHaveLength(1)
  })

  it('21. a lead who unsubscribed from the business email is never invited', async () => {
    const o = await owner()
    await db('automation_lead_suppressions').insert({ agencyId: A, leadId: o.lead, source: 'unsubscribe_link' })
    const { buttons } = await reviewing(o)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
    expect(h.emails).toHaveLength(0)
  })

  it('22. no customer sender configured (AUTOMATIONS_FROM): never offered, and no email', async () => {
    delete process.env.AUTOMATIONS_FROM
    const o = await owner()
    const { buttons } = await reviewing(o)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
    expect(h.emails).toHaveLength(0)
  })

  it('23. the reference arriving on another business number of the same agency opens nothing', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    await db('whatsapp_connections').insert({ user_id: o.u, agency_id: A, phone_number_id: '__qi_pn_second', access_token: 'x' })
    await handleInboundWebhookMessage({
      message: { id: `wamid.__qi_c_${++seq}`, from: o.waId, timestamp: String(NOW()), type: 'text', text: { body: invitationOf().prefill } },
      phoneNumberId: '__qi_pn_second',
      profileName: 'דוד',
      connection: { agency_id: A, user_id: o.u },
    })
    await db('whatsapp_connections').where({ phone_number_id: '__qi_pn_second' }).del()
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('sent')
  })

  it('24. an agency outside the allowlist: no invitation offered, and a reference reaching it does nothing', async () => {
    process.env.WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS = `${A}`
    const o = await owner()
    const { quoteId } = await invited(o)
    const ob = await owner(B, { email: 'b-lead@example.test' })
    const { buttons } = await reviewing(ob)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['edit', 'cancel'])
    expect(h.emails).toHaveLength(1)
    // Even a row for B (should one exist) is never matched while B is off.
    await db('sales_quote_invitations').where({ quoteId }).update({ agencyId: B, businessPhoneNumberId: pn(B) })
    await customerWrites(ob, invitationOf().prefill, { agencyId: B, from: o.waId })
    expect(customer()).toHaveLength(0)
    expect(h.enqueues).toBe(1) // an ordinary message for B
  })

  it('25. the invitation switch removed after the email went out: the reply delivers nothing', async () => {
    const o = await owner()
    const { quoteId } = await invited(o)
    delete process.env.WA_ASSISTANT_QUOTES_EMAIL_INVITE_AGENCY_IDS
    await customerWrites(o, invitationOf().prefill)
    expect(customer()).toHaveLength(0)
    expect((await invitations(quoteId))[0].state).toBe('sent')
  })
})

describe('the reference and the link', () => {
  it('19. references are 80-bit, unguessable, and survive the customer typing around them', () => {
    const refs = new Set(Array.from({ length: 500 }, () => newInvitationRef()))
    expect(refs.size).toBe(500)
    const ref = [...refs][0]
    expect(ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
    expect(invitationRefIn(`היי!! ${invitationPrefill(ref).toLowerCase()} תודה`)).toBe(ref)
    expect(invitationRefIn('אשמח לקבל הצעת מחיר')).toBeNull()
    expect(invitationRefIn('SCQ-SHORT')).toBeNull()
    expect(whatsappClickToChat('+972 3-555-0101', 'א ב')).toBe('https://wa.me/97235550101?text=%D7%90%20%D7%91')
    expect(whatsappClickToChat('12', 'x')).toBeNull()
  })
})
