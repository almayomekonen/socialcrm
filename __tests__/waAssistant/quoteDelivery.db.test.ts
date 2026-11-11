import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Review, edit and customer delivery of a WhatsApp quote, against a real (local
 * test) PostgreSQL: webhook handler → worker → card → tap → the REAL Action
 * Runtime, executors, claim, opt-out gate and status ingest. Only the model, the
 * renderer, R2 and Meta are stood in for; `fetch` is stubbed, so nothing leaves
 * this machine.
 *
 * NOTE: over the 250-line soft limit on purpose, like quotes.db.test.ts: one flat
 * list of independent scenarios over one shared harness.
 */
const h = vi.hoisted(() => ({ agent: true, jobs: [] as (() => Promise<void>)[], pdfSeq: 0, presignFails: false }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => h.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (job: () => Promise<void>) => void h.jobs.push(job) }))
vi.mock('@/lib/pdf/renderer', async (orig) => ({ ...(await orig<typeof import('@/lib/pdf/renderer')>()), renderPdfFromHtml: async () => new Uint8Array([37, 80, 68, 70, ++h.pdfSeq]) }))
vi.mock('@/lib/storage/objects', async (orig) => ({
  ...(await orig<typeof import('@/lib/storage/objects')>()),
  putObject: async () => undefined,
  headObject: async () => ({ size: 5 }),
  presignDownload: async (i: { key: string }) => {
    if (h.presignFails) throw new Error('storage down')
    return `https://r2.test/${i.key}?sig=1`
  },
}))

import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { startQuotePdf } from '@/lib/waAssistant/quotes/pdfJob'
import { DELIVERY_COPY } from '@/lib/waAssistant/quotes/deliveryCopy'
import { asksToReviewQuote } from '@/lib/waAssistant/quotes/review'
import { QUOTE_DELIVERY_TEMPLATE } from '@/lib/waAssistant/quotes/customerSend'
import { claimQuoteDelivery } from '@/db/quotes/deliveries'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { sendQuoteToCustomer } from '@/lib/waAssistant/quotes/customerSend'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { claimQuoteRender, markQuoteDocumentReady } from '@/db/quotes/documents'
import { editQuoteSystem } from '@/db/quotes/editQuote'
import { ingestWhatsappStatuses } from '@/lib/inbox/ingestWhatsappStatuses'
import { groundedProposal } from '@/lib/agent/proposalGate'
import { hashQuoteLinkToken } from '@/lib/quotes/deliveryLink'
import { GET as linkPage, POST as exchangeLink } from '@/app/api/q/route'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0
const NOW = () => Math.floor(Date.now() / 1000)
const pn = (agencyId: number) => `__qd_pn_${agencyId}`

// ── Meta ──────────────────────────────────────────────────────────────────────
type Call = { url: string; body: any }
let calls: Call[] = []
let customerReply: () => Response | Promise<Response>
const ok = () => new Response(JSON.stringify({ messages: [{ id: `wamid.HBgM_${++seq}` }] }), { status: 200 })
const platform = () => calls.filter((c) => c.url.includes(`/${PLATFORM}/`) && c.body?.messaging_product && !c.body?.status)
const customer = () => calls.filter((c) => c.url.includes('/__qd_pn_'))
const lastOwner = () => platform().at(-1)!.body
const ownerText = () => (lastOwner().text?.body ?? lastOwner().interactive?.body?.text) as string
const previews = () => platform().filter((c) => c.body.interactive?.header?.type === 'document')
const buttonsOf = (body: any) => body.interactive.action.buttons.map((b: any) => b.reply.id) as string[]

// ── One owner, one lead, one connected business number ────────────────────────
type Owner = { u: number; digits: string; lead: number; waId: string }
async function owner(agencyId = A, role = 'ADMIN', inboundAgoMs: number | null = 60_000): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000076${String(++seq).padStart(2, '0')}`
  await recipient(agencyId, u, digits, undefined, 'v4')
  const waId = `97252${String(1000000 + ++seq)}`
  const [c] = await db('clients').insert({ firstName: 'דוד', lastName: 'כהן', phone: `0${waId.slice(3)}`, agencyId, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  const lead = Number(c.id)
  if (!(await db('whatsapp_connections').where({ agency_id: agencyId }).first('id'))) await db('whatsapp_connections').insert({ user_id: u, agency_id: agencyId, phone_number_id: pn(agencyId), access_token: 'x' })
  await db('inbox_conversations').insert({ agencyId, leadId: lead, channel: 'whatsapp', businessPhoneNumberId: pn(agencyId), customerWaId: waId, lastInboundAt: inboundAgoMs == null ? null : new Date(Date.now() - inboundAgoMs) })
  return { u, digits, lead, waId }
}

const say = (o: { digits: string }, body: string) => processPlatformMessage({ id: `wamid.__qd_${++seq}`, from: o.digits, timestamp: String(NOW()), type: 'text', text: { body } } as never)
const tapRaw = (digits: string, id: string, wamid = `wamid.__qd_${++seq}`) => processPlatformMessage({ id: wamid, from: digits, timestamp: String(NOW()), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } } as never)

type AgentResult = Record<string, unknown>
const results: AgentResult[] = []
const worker = () => runWaAssistantWorker({}, { runAgent: (async () => results.shift()) as never, typing: (async () => undefined) as never })
const tap = async (o: { digits: string }, id: string) => {
  await tapRaw(o.digits, id)
  await worker()
}
const drain = async () => {
  while (h.jobs.length) await h.jobs.shift()!()
}

const answerWith = (proposedAction: unknown, leads: number[] = []): AgentResult => ({
  ok: true,
  answer: { headline: 'h', claims: [], unknown: null, proposedAction },
  evidence: leads.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered',
  investigationId: `inv_qd_${++seq}`,
  costUsd: 0.01,
})
const createQuote = (lead: number) => answerWith({ actionType: 'create_quote', args: { clientId: lead, title: 'שיפוץ מטבח', lines: [{ title: 'שיפוץ מטבח', quantity: null, unitAmount: 18500, discountAmount: null, discountPercent: null }], priceBasis: 'incl_vat', validityDays: null }, evidenceRefs: [`lead:${lead}`] }, [lead])
const editPrice = (unitAmount: number) => answerWith({ actionType: 'edit_quote', args: { title: null, validityDays: null, priceBasis: 'incl_vat', changes: [{ op: 'update', match: null, lineNumber: null, title: null, quantity: null, unitAmount, discountAmount: null, discountPercent: null }] }, evidenceRefs: [] })

/** A real quote through the real path, its PDF rendered, the owner holding the send card. */
async function reviewing(o: Owner) {
  results.push(createQuote(o.lead))
  await say(o, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ')
  await worker()
  await tap(o, buttonsOf(lastOwner())[0])
  await drain()
  const q = await db('sales_quotes').where({ leadId: o.lead }).first('id')
  const card = previews().at(-1)?.body
  return { quoteId: Number(q.id), card, buttons: card ? buttonsOf(card) : [] }
}
const quoteRow = (id: number) => db('sales_quotes').where({ id }).first('status', 'version', 'totalAmount', 'sentAt', 'sentByUserId')
const deliveries = (quoteId: number) => db('sales_quote_deliveries').where({ quoteId }).orderBy('id')
async function recordCustomerOptOut(waId: string) {
  const { recordInboundOptOut } = await import('@/lib/whatsapp/optOut/recordInbound')
  expect(await recordInboundOptOut({ agencyId: A, customerWaId: waId, type: 'text', text: 'STOP', externalId: `wamid.__qd_stop_${++seq}`, channelTimestamp: new Date() })).not.toBeNull()
}
const eventsOf = async (quoteId: number) => (await db('sales_quote_events').where({ quoteId }).orderBy('id').select('type')).map((e) => e.type as string)

beforeAll(async () => {
  A = await agency('__qd_a__')
  B = await agency('__qd_b__')
  await db.raw(`UPDATE agencies SET "businessType" = 'authorized' WHERE id IN (?, ?)`, [A, B])
  await db('bill_tax_rates').whereIn('agencyId', [A, B]).del()
  for (const agencyId of [A, B]) await db('bill_tax_rates').insert({ agencyId, code: 'VAT_STD', label: 'מע"מ', ratePercent: 18, country: 'IL', effectiveFrom: '2024-01-01' })
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions', 'agent_requests', 'whatsapp_opt_out_events']) await db(t).del().catch(() => undefined)
  await db('whatsapp_opt_outs').whereIn('agencyId', [A, B]).del().catch(() => undefined)
  await db('whatsapp_templates').whereIn('agencyId', [A, B]).del()
  await db('sales_quotes').whereIn('agencyId', [A, B]).del()
  await db('inbox_conversations').whereIn('agencyId', [A, B]).del()
  await db('bill_numbering_sequences').whereIn('agencyId', [A, B]).del()
  await db('agencies').whereIn('id', [A, B]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  h.agent = true
  h.jobs.length = 0
  h.presignFails = false
  results.length = 0
  calls = []
  customerReply = ok
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init?.body ?? 'null')) }
    calls.push(call)
    return call.url.includes('/__qd_pn_') ? customerReply() : ok()
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

describe('the preview: the PDF itself, and nothing to the customer', () => {
  it('a ready PDF reaches the owner as a document with three buttons; the customer gets nothing', async () => {
    const o = await owner()
    const { quoteId, card, buttons } = await reviewing(o)
    expect(card.interactive.header.document.link).toContain('https://r2.test/tenants/')
    expect(card.interactive.header.document.filename).toMatch(/^Quote-\d+-.+\.pdf$/)
    expect(buttons.map((b) => b.split(':')[1])).toEqual(['approve', 'edit', 'reject'])
    expect(card.to).toBe(o.digits)
    expect(card.interactive.body.text).toContain('שום דבר לא יישלח ללקוח לפני שתאשרו')
    expect(card.interactive.body.text).toContain('*טיוטת הצעת המחיר מוכנה לבדיקה*')
    expect(platform().some((c) => JSON.stringify(c.body).includes('זו טיוטה: ההצעה לא נשלחה ללקוח.'))).toBe(true)
    expect(card.interactive.body.text).toContain('הליד יקבל בוואטסאפ קישור לקובץ המצורף')
    expect(card.interactive.body.text).toContain(`מספר שמסתיים ב-${o.waId.slice(-4)}`)
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
    expect((await quoteRow(quoteId)).status).toBe('ready')
    expect(await eventsOf(quoteId)).toContain('preview_offered')
  })

  it('the approval is bound to the exact version, PDF, recipient number and business number', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    const card = await db('wa_assistant_approvals').where({ token: buttons[0].split(':')[2] }).first('actionId', 'argsHash')
    const action = await db('agent_actions').where({ actionId: card.actionId }).first('actionType', 'args', 'argsHash')
    const doc = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id', 'contentHash')
    expect(action.actionType).toBe('send_quote')
    expect(action.argsHash).toBe(card.argsHash)
    expect(action.args).toEqual({ quoteId, version: 1, documentId: Number(doc.id), contentHash: doc.contentHash, leadId: o.lead, customerPhoneE164: `+${o.waId}`, businessPhoneNumberId: pn(A) })
  })

  it('off for this agency: the create-and-download flow exactly, with no card', async () => {
    delete process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS
    const o = await owner()
    const { card } = await reviewing(o)
    expect(card).toBeUndefined()
    expect(ownerText()).toContain('להורדה:')
    expect(ownerText()).toContain('ההצעה לא נשלחה ללקוח')
    expect(customer()).toHaveLength(0)
  })

  it('no way to show the PDF means no request to approve it', async () => {
    h.presignFails = true
    const o = await owner()
    const { card, quoteId } = await reviewing(o)
    expect(card).toBeUndefined()
    expect(ownerText()).toContain(DELIVERY_COPY.pdfUnavailable)
    expect(await db('agent_actions').where({ actionType: 'send_quote' })).toHaveLength(0)
    expect(await eventsOf(quoteId)).toContain('preview_blocked')
  })
})

describe('approve and send', () => {
  it('sends once, to the exact number, with a link; the quote, the audit and the owner agree', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])

    expect(customer()).toHaveLength(1)
    const sent = customer()[0].body
    expect(sent.to).toBe(o.waId)
    expect(sent.text.body).toMatch(/https:\/\/getsocialcrm\.com\/api\/q#[A-Za-z0-9_-]{43}/)
    expect(sent.text.body).not.toContain('₪')

    const [d] = await deliveries(quoteId)
    expect(d).toMatchObject({ state: 'accepted', channel: 'text', quoteVersion: 1, customerPhoneE164: `+${o.waId}`, approvedByUserId: o.u })
    expect(d.wamid).toBeTruthy()
    expect(await quoteRow(quoteId)).toMatchObject({ status: 'sent', sentByUserId: o.u })
    expect(ownerText()).toContain('הצעת המחיר נשלחה ללקוח')
    expect(ownerText()).toContain(`מספר שמסתיים ב-${o.waId.slice(-4)}`)
    expect(await eventsOf(quoteId)).toEqual(expect.arrayContaining(['preview_offered', 'send_accepted']))

    const token = /\/api\/q#([A-Za-z0-9_-]{43})/.exec(sent.text.body)![1]
    expect(d.linkTokenHash).toBe(hashQuoteLinkToken(token))
    expect(JSON.stringify(d)).not.toContain(token)
    const inbox = await db('inbox_messages').where({ agencyId: A, externalId: d.wamid }).first('text', 'metadata')
    expect(JSON.stringify(inbox)).not.toContain(token)
    expect(inbox.metadata.source).toBe('quote_delivery')
  })

  it('a double tap and a webhook redelivery of the tap never send twice', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    const wamid = `wamid.__qd_dup_${++seq}`
    await tapRaw(o.digits, buttons[0], wamid)
    await tapRaw(o.digits, buttons[0], wamid)
    await worker()
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(1)
    expect(await deliveries(quoteId)).toHaveLength(1)
    expect(ownerText()).toBe(DELIVERY_COPY.alreadyDecided)
  })

  it('declining sends nothing, leaves the quote ready, and is on the record', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[2])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.declined)
    expect((await quoteRow(quoteId)).status).toBe('ready')
    expect(await eventsOf(quoteId)).toContain('send_declined')
  })

  it('a typed "yes" or "send it" never sends: only the button does', async () => {
    const o = await owner()
    await reviewing(o)
    await say(o, 'כן')
    await worker()
    expect(customer()).toHaveLength(0)
    await say(o, 'תשלח את ההצעה ללקוח')
    await worker()
    expect(customer()).toHaveLength(0)
    expect(previews().length).toBe(2)
  })

  it('two concurrent claims on one quote: exactly one wins', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    const doc = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id', 'contentHash')
    const claim = (n: number) => claimQuoteDelivery({ agencyId: A, quoteId, quoteVersion: 1, documentId: Number(doc.id), contentHash: doc.contentHash, actionId: `act_race_${n}`, leadId: o.lead, approvedByUserId: o.u, customerPhoneE164: `+${o.waId}`, businessPhoneNumberId: pn(A), channel: 'text', linkTokenHash: `hash_${n}`, linkExpiresAt: new Date(Date.now() + 1e6), businessDate: '2026-11-10' })
    const r = await Promise.all([1, 2, 3, 4].map(claim))
    expect(r.filter((x) => x.kind === 'claimed')).toHaveLength(1)
    expect(r.filter((x) => x.kind === 'duplicate')).toHaveLength(3)
  })
})

describe('audit: races and other ways in', () => {
  const sendArgsOf = async (quoteId: number, o: Owner) => {
    const doc = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id', 'contentHash')
    return { quoteId, version: 1, documentId: Number(doc.id), contentHash: doc.contentHash as string, leadId: o.lead, customerPhoneE164: `+${o.waId}`, businessPhoneNumberId: pn(A) }
  }

  it('the web approval path cannot run a send without the WhatsApp token', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    const card = await db('wa_assistant_approvals').where({ token: buttons[0].split(':')[2] }).first('actionId', 'argsHash')
    const scope = { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [o.u] } as never
    const r = await decideOnAction({ actionId: card.actionId, argsHash: card.argsHash, decision: 'APPROVED', scope })
    expect(r.ok && r.outcome.execution?.reason).toBe('no-approved-card')
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
  })

  it('a card that was superseded cannot be replayed through the web path either', async () => {
    const o = await owner()
    const { buttons } = await reviewing(o)
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    const old = await db('wa_assistant_approvals').where({ token: buttons[0].split(':')[2] }).first('actionId', 'argsHash', 'status')
    expect(old.status).toBe('superseded')
    const r = await decideOnAction({ actionId: old.actionId, argsHash: old.argsHash, decision: 'APPROVED', scope: { agencyId: A, userId: o.u, role: 'ADMIN', gotPermIds: [o.u] } as never })
    expect(r.ok && r.outcome.execution?.reason).toBe('no-approved-card')
    expect(customer()).toHaveLength(0)
  })

  it('concurrent sends from two approved actions reach Meta exactly once', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    const args = await sendArgsOf(quoteId, o)
    const r = await Promise.all(['act_c1', 'act_c2', 'act_c3'].map((actionId) => sendQuoteToCustomer({ agencyId: A, userId: o.u, actionId, args, nowMs: Date.now() })))
    expect(customer()).toHaveLength(1)
    expect(r.filter((x) => x.kind === 'accepted')).toHaveLength(1)
    expect(await deliveries(quoteId)).toHaveLength(1)
  })

  it('a retry of one action after a crash mid-send never sends again', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    const args = await sendArgsOf(quoteId, o)
    const { version: quoteVersion, ...row } = args
    expect((await claimQuoteDelivery({ ...row, quoteVersion, agencyId: A, actionId: 'act_crash', approvedByUserId: o.u, channel: 'text', linkTokenHash: 'h_crash', linkExpiresAt: new Date(Date.now() + 1e6), businessDate: '2026-11-10' })).kind).toBe('claimed')
    const r = await sendQuoteToCustomer({ agencyId: A, userId: o.u, actionId: 'act_crash', args, nowMs: Date.now() })
    expect(r.kind).toBe('duplicate')
    expect(customer()).toHaveLength(0)
  })

  it('an edit racing a send: one wins, and the two never both happen', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    const args = await sendArgsOf(quoteId, o)
    const [edit, sent] = await Promise.all([
      editQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, title: 'שיפוץ', lines: [{ title: 'שיפוץ', description: '', quantity: 1, unitPrice: 1000, discount: 0 }], validityDays: null, expectedTotalAmount: 1180, expectedRatePercent: 18, actionId: 'act_e_race', actorUserId: o.u, visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, nowMs: Date.now() }),
      sendQuoteToCustomer({ agencyId: A, userId: o.u, actionId: 'act_s_race', args, nowMs: Date.now() }),
    ])
    expect(edit.ok !== (sent.kind === 'accepted')).toBe(true)
    expect(customer().length).toBe(sent.kind === 'accepted' ? 1 : 0)
  })

  it('an edit retires other open cards about the quote, edit cards included', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    const pendingEdit = buttonsOf(lastOwner())[0].split(':')[2]
    await editQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, title: 'שיפוץ', lines: [{ title: 'שיפוץ', description: '', quantity: 1, unitPrice: 1000, discount: 0 }], validityDays: null, expectedTotalAmount: 1180, expectedRatePercent: 18, actionId: 'act_other', actorUserId: o.u, visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, nowMs: Date.now() })
    expect((await db('wa_assistant_approvals').where({ token: pendingEdit }).first('status')).status).toBe('superseded')
  })

  it('someone who can no longer see the lead does not receive its PDF', async () => {
    const o = await owner(A, 'MNGR')
    const { quoteId, buttons } = await reviewing(o)
    expect(buttons).toHaveLength(3)
    const other = await user(A, 'AGNT')
    await db('clients').where({ id: o.lead }).update({ userId: other })
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    expect(previews()).toHaveLength(1)
    expect(ownerText()).toBe(DELIVERY_COPY.notAllowed)
    expect(await eventsOf(quoteId)).toContain('preview_blocked')
  })

  it('a quote past its validity date is neither offered nor sent', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await db('sales_quotes').where({ id: quoteId }).update({ expiresAt: '2020-01-01' })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.stale)
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    expect(ownerText()).toBe(DELIVERY_COPY.quoteExpired)
  })

  it('a lost PDF after a late edit is recovered by the sweep', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    await db('sales_quotes').where({ id: quoteId }).update({ readyAt: new Date(Date.now() - 3 * 3600_000) })
    await editQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, title: 'שיפוץ', lines: [{ title: 'שיפוץ', description: '', quantity: 1, unitPrice: 1000, discount: 0 }], validityDays: null, expectedTotalAmount: 1180, expectedRatePercent: 18, actionId: 'act_late', actorUserId: o.u, visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, nowMs: Date.now() })
    const before = previews().length
    await sweepQuotePdfs()
    expect(previews().length).toBe(before + 1)
    expect(previews().at(-1)!.body.interactive.body.text).toContain('(גרסה 2)')
  })

  it('asking to see a quote whose PDF is missing promises it, and keeps the promise', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    await db('sales_quote_documents').where({ quoteId, isCurrent: true }).update({ isCurrent: false })
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    expect(ownerText()).toBe(DELIVERY_COPY.pdfPending)
    const before = previews().length
    await drain()
    expect(previews().length).toBe(before + 1)
  })

  it('with the flag off, a delivery receipt does no quote work at all', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])
    const [d] = await deliveries(quoteId)
    delete process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS
    await ingestWhatsappStatuses(pn(A), [{ id: d.wamid, status: 'delivered', timestamp: String(NOW()) }])
    expect((await deliveries(quoteId))[0].state).toBe('accepted')
  })
})

describe('usage credits', () => {
  const CREDITS = ['CREDITS_METERING', 'CREDITS_ENFORCE_ON_PRO', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCEMENT_AGENCY_IDS']
  const count = async () => Number((await db('agent_requests').where({ agencyId: A }).count('id as n').first())!.n)
  const meter = (allowance: number) => Object.assign(process.env, { CREDITS_METERING: '1', CREDITS_ENFORCE_ON_PRO: '1', CREDITS_MONTHLY_ALLOWANCE: String(allowance), CREDITS_ENFORCEMENT_AGENCY_IDS: String(A) })
  afterEach(() => {
    for (const k of CREDITS) delete process.env[k]
  })

  it('with the allowance used up, reviewing and approving the send still work and add nothing', async () => {
    meter(1)
    const o = await owner()
    await reviewing(o)
    expect(await count()).toBe(1)
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    await tap(o, buttonsOf(previews().at(-1)!.body)[0])
    expect(customer()).toHaveLength(1)
    expect(await count()).toBe(1)
  })

  it('an edit is charged as one AI request, and applying it as none', async () => {
    meter(100)
    const o = await owner()
    await reviewing(o)
    const before = await count()
    expect(before).toBe(1)
    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    expect(await count()).toBe(before + 1)
    await tap(o, buttonsOf(lastOwner())[0])
    expect(await count()).toBe(before + 1)
  })
})

describe('anything that changed since the preview stops the send', () => {
  it('a new version', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await db('sales_quotes').where({ id: quoteId }).update({ version: 2 })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.stale)
    expect(await deliveries(quoteId)).toHaveLength(0)
  })
  it('a different PDF', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await db('sales_quote_documents').where({ quoteId, isCurrent: true }).update({ contentHash: createHash('sha256').update('other').digest('hex') })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.stale)
  })
  it('a different customer number', async () => {
    const o = await owner()
    const { buttons } = await reviewing(o)
    await db('inbox_conversations').where({ agencyId: A, leadId: o.lead }).update({ customerWaId: '972529999999' })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.stale)
  })
  it('a customer who opted out in the meantime', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await recordCustomerOptOut(o.waId)
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.optedOut)
    expect((await deliveries(quoteId))[0]).toMatchObject({ state: 'failed', failureCode: 'opted_out' })
    expect((await quoteRow(quoteId)).status).toBe('ready')
  })
  it('the pilot switch turned off', async () => {
    const o = await owner()
    const { buttons } = await reviewing(o)
    delete process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
  })
})

describe('who may act', () => {
  it('another phone holding the button id gets nothing', async () => {
    const o = await owner()
    const other = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(other, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
    expect((await quoteRow(quoteId)).status).toBe('ready')
  })
  it('an owner in another agency gets nothing', async () => {
    const o = await owner()
    const foreign = await owner(B)
    const { quoteId, buttons } = await reviewing(o)
    await tap(foreign, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
  })
  it('a role lowered after the card was issued cannot send', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await db('users').where({ id: o.u }).update({ role: 'AGNT' })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(await deliveries(quoteId)).toHaveLength(0)
  })
  it('a rep is told plainly, and gets no card to approve', async () => {
    const o = await owner(A, 'AGNT')
    const { card } = await reviewing(o)
    expect(card).toBeUndefined()
    expect(ownerText()).toContain(DELIVERY_COPY.noSendPermission)
  })
  it('an expired card sends nothing', async () => {
    const o = await owner()
    const { buttons } = await reviewing(o)
    await db('wa_assistant_approvals').where({ token: buttons[0].split(':')[2] }).update({ expiresAt: new Date(Date.now() - 1000) })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(0)
    expect(ownerText()).toBe(DELIVERY_COPY.expired)
  })
  it('the model cannot name a send: the proposal gate drops it', () => {
    expect(groundedProposal({ actionType: 'send_quote', args: { clientId: 1 }, evidenceRefs: [] } as never, { has: () => true } as never)).toBeNull()
  })
  it('a forged edit button on another kind of card does nothing', async () => {
    const o = await owner()
    results.push(createQuote(o.lead))
    await say(o, 'תכין הצעת מחיר לדוד כהן עבור שיפוץ מטבח, 18,500 שקל כולל מע"מ')
    await worker()
    const createToken = buttonsOf(lastOwner())[0].split(':')[2]
    const sent = calls.length
    await tap(o, `wa:edit:${createToken}`)
    expect(calls.length).toBe(sent)
    expect(await db('sales_quotes').where({ leadId: o.lead })).toHaveLength(0)
  })
})

describe('editing before approval', () => {
  it('the edit button only asks what to change; the card stays valid', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[1])
    expect(ownerText()).toBe(DELIVERY_COPY.editPrompt)
    expect((await quoteRow(quoteId)).version).toBe(1)
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(1)
  })

  it('an edit → a card → version 2 → the old approval is dead → a new PDF and a new approval', async () => {
    const o = await owner()
    const { quoteId, buttons: first } = await reviewing(o)
    const v1 = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id')

    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    expect(ownerText()).toContain('*לעדכן את הצעת המחיר')
    expect(ownerText()).toContain('*סה"כ: ₪20,000.00*')
    expect((await quoteRow(quoteId)).version).toBe(1)
    await tap(o, buttonsOf(lastOwner())[0])
    expect(await quoteRow(quoteId)).toMatchObject({ version: 2, status: 'ready' })
    expect(Number((await quoteRow(quoteId)).totalAmount)).toBe(20000)
    expect(ownerText()).toContain('לא נשלח דבר ללקוח')
    expect(ownerText()).toContain('האישור הקודם לשליחה בוטל.')
    expect(ownerText()).toContain('קובץ PDF חדש')

    await tap(o, first[0])
    expect(customer()).toHaveLength(0)

    await drain()
    const doc = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('id', 'quoteVersion')
    expect(Number(doc.id)).not.toBe(Number(v1.id))
    expect(Number(doc.quoteVersion)).toBe(2)
    const next = previews().at(-1)!.body
    expect(next.interactive.body.text).toContain('(גרסה 2)')
    await tap(o, buttonsOf(next)[0])
    expect(customer()).toHaveLength(1)
    expect((await deliveries(quoteId))[0]).toMatchObject({ quoteVersion: 2, documentId: doc.id })
    expect(await eventsOf(quoteId)).toEqual(expect.arrayContaining(['edited', 'send_accepted']))
  })

  it('a price the owner did not say is never applied', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    results.push(editPrice(99999))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    expect(ownerText()).toBe(DELIVERY_COPY.askNewPrice)
    expect((await quoteRow(quoteId)).version).toBe(1)
  })

  it('declining an edit leaves the quote alone and offers the send card again', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    await tap(o, buttonsOf(lastOwner())[1])
    expect((await quoteRow(quoteId)).version).toBe(1)
    expect(ownerText()).toContain(DELIVERY_COPY.editDeclined)
    await tap(o, buttonsOf(lastOwner())[0])
    expect(customer()).toHaveLength(1)
  })

  it('a quote that has gone out cannot be edited', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    const editApprove = buttonsOf(lastOwner())[0]
    // The edit's card superseded the send card, so issue a fresh one and send through it.
    await db('wa_assistant_approvals').where({ token: editApprove.split(':')[2] }).update({ status: 'superseded' })
    await db('wa_assistant_approvals').where({ token: buttons[0].split(':')[2] }).update({ status: 'pending' })
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(1)
    await db('wa_assistant_approvals').where({ token: editApprove.split(':')[2] }).update({ status: 'pending' })
    await tap(o, editApprove)
    expect(ownerText()).toBe(DELIVERY_COPY.editStale)
    expect((await quoteRow(quoteId)).version).toBe(1)
  })

  it('a render still running for the old version can never become current', async () => {
    const o = await owner()
    const { quoteId } = await reviewing(o)
    await db('sales_quote_documents').where({ quoteId, isCurrent: true }).update({ isCurrent: false })
    const stale = await claimQuoteRender({ agencyId: A, quoteId, path: 'tenants/x/old.pdf', renderedByUserId: o.u })
    const edited = await editQuoteSystem({ agencyId: A, quoteId, expectedVersion: 1, title: 'שיפוץ', lines: [{ title: 'שיפוץ', description: '', quantity: 1, unitPrice: 1000, discount: 0 }], validityDays: null, expectedTotalAmount: 1180, expectedRatePercent: 18, actionId: 'act_edit_race', actorUserId: o.u, visibility: { user: { role: 'ADMIN' as never }, gotPermIds: [] }, nowMs: Date.now() })
    expect(edited.ok).toBe(true)
    expect(await markQuoteDocumentReady({ documentId: stale!, agencyId: A, quoteId, contentHash: 'old', byteSize: 1 })).toBe(false)
    expect(await db('sales_quote_documents').where({ quoteId, isCurrent: true })).toHaveLength(0)
    expect(await startQuotePdf({ agencyId: A, quoteId, renderedByUserId: o.u, inline: true })).toBe('started')
    const row = await db('sales_quote_documents').where({ quoteId, isCurrent: true }).first('quoteVersion')
    expect(Number(row.quoteVersion)).toBe(2)
  })
})

describe('delivery failures', () => {
  it('Meta refuses: failed, link dead, quote still ready, owner told, and a new approval can retry once', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    customerReply = () => new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 })
    await tap(o, buttons[0])
    expect(ownerText()).toBe(DELIVERY_COPY.sendFailed)
    expect((await deliveries(quoteId))[0]).toMatchObject({ state: 'failed', failureCode: '131026' })
    expect((await deliveries(quoteId))[0].linkRevokedAt).not.toBeNull()
    expect((await quoteRow(quoteId)).status).toBe('ready')

    customerReply = ok
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    await tap(o, buttonsOf(previews().at(-1)!.body)[0])
    expect(customer()).toHaveLength(2)
    expect((await deliveries(quoteId)).map((d) => d.state)).toEqual(['failed', 'accepted'])
  })

  it('no answer from Meta: unknown, never resent, and the owner is told to check', async () => {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    customerReply = () => new Response('bad gateway', { status: 502 })
    await tap(o, buttons[0])
    expect(ownerText()).toBe(DELIVERY_COPY.sendUnknown)
    expect((await deliveries(quoteId))[0].state).toBe('unknown')
    customerReply = ok
    await say(o, 'תראה לי שוב את ההצעה')
    await worker()
    expect(ownerText()).toBe(DELIVERY_COPY.sendUnknown)
    expect(customer()).toHaveLength(1)
    expect(previews()).toHaveLength(1)
    results.push(editPrice(20000))
    await say(o, 'תשנה את המחיר ל-20,000 כולל מע"מ')
    await worker()
    expect(ownerText()).toBe(DELIVERY_COPY.editStale)
    expect((await quoteRow(quoteId)).version).toBe(1)
  })

  it('the service window closed and no approved template: the owner is told before any approval', async () => {
    const o = await owner(A, 'ADMIN', 2 * 24 * 3600_000)
    const { card, quoteId } = await reviewing(o)
    expect(card).toBeUndefined()
    expect(ownerText()).toContain(DELIVERY_COPY.windowClosed)
    expect(await eventsOf(quoteId)).toContain('preview_blocked')
  })

  it('the service window closed with an approved UTILITY template: the template goes out', async () => {
    const o = await owner(A, 'ADMIN', 2 * 24 * 3600_000)
    await db('whatsapp_templates').insert({ agencyId: A, wabaId: 'w', name: QUOTE_DELIVERY_TEMPLATE, displayTitle: 'q', language: 'he', category: 'UTILITY', status: 'approved', bodyText: 'שלום {{1}}, הצעה {{2}} מ-{{3}}: {{4}}' })
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])
    expect(customer()).toHaveLength(1)
    expect(customer()[0].body.type).toBe('template')
    expect(customer()[0].body.template.components[0].parameters).toHaveLength(4)
    expect((await deliveries(quoteId))[0].channel).toBe('template')
  })

  it('a marketing template is not used', async () => {
    const o = await owner(A, 'ADMIN', 2 * 24 * 3600_000)
    await db('whatsapp_templates').insert({ agencyId: A, wabaId: 'w', name: QUOTE_DELIVERY_TEMPLATE, displayTitle: 'q', language: 'he', category: 'MARKETING', status: 'approved', bodyText: '{{1}} {{2}} {{3}} {{4}}' })
    const { card } = await reviewing(o)
    expect(card).toBeUndefined()
  })
})

describe('delivery receipts', () => {
  async function sent() {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])
    const [d] = await deliveries(quoteId)
    return { o, quoteId, wamid: d.wamid as string }
  }
  const receipt = async (wamid: string, status: string, errors?: unknown[]) => {
    await ingestWhatsappStatuses(pn(A), [{ id: wamid, status, timestamp: String(NOW()), errors }])
    await drain()
  }

  it('delivered: recorded, and the owner hears once, however often Meta repeats it', async () => {
    const { o, quoteId, wamid } = await sent()
    const before = platform().length
    await receipt(wamid, 'delivered')
    await receipt(wamid, 'delivered')
    expect((await deliveries(quoteId))[0].state).toBe('delivered')
    expect(platform().length).toBe(before + 1)
    expect(lastOwner().to).toBe(o.digits)
    expect(ownerText()).toContain('נמסרה ללקוח')
  })

  it('read is recorded without another message, and never moves backwards', async () => {
    const { quoteId, wamid } = await sent()
    await receipt(wamid, 'read')
    const before = platform().length
    await receipt(wamid, 'delivered')
    expect((await deliveries(quoteId))[0].state).toBe('read')
    expect(platform().length).toBe(before)
  })

  it('failed after acceptance: the link dies, the quote returns to ready, the owner is told', async () => {
    const { quoteId, wamid } = await sent()
    await receipt(wamid, 'failed', [{ code: 131049 }])
    const [d] = await deliveries(quoteId)
    expect(d).toMatchObject({ state: 'failed', failureCode: '131049' })
    expect(d.linkRevokedAt).not.toBeNull()
    expect(await quoteRow(quoteId)).toMatchObject({ status: 'ready', sentAt: null })
    expect(ownerText()).toContain('לא נמסרה ללקוח')
  })

  it('a receipt for another agency’s business number changes nothing', async () => {
    const { quoteId, wamid } = await sent()
    await owner(B)
    await ingestWhatsappStatuses(pn(B), [{ id: wamid, status: 'delivered', timestamp: String(NOW()) }])
    expect((await deliveries(quoteId))[0].state).toBe('accepted')
  })
})

describe('the customer’s link', () => {
  async function linked() {
    const o = await owner()
    const { quoteId, buttons } = await reviewing(o)
    await tap(o, buttons[0])
    const token = /\/api\/q#([A-Za-z0-9_-]{43})/.exec(customer()[0].body.text.body)![1]
    return { o, quoteId, token }
  }
  const open = (token: unknown) => exchangeLink(new NextRequest('https://x.test/api/q', { method: 'POST', body: JSON.stringify({ token }), headers: { 'Content-Type': 'application/json' } }))

  it('the token is in the fragment: the page request carries nothing, and serves only a static page', async () => {
    const { token } = await linked()
    expect(customer()[0].body.text.body).toContain(`/api/q#${token}`)
    const res = linkPage()
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('/quote-open.mjs')
    expect(html).not.toContain(token)
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('exchanges the token for exactly that quote’s PDF, briefly, and records the first open once', async () => {
    const { quoteId, token } = await linked()
    const res = await open(token)
    expect(res.status).toBe(200)
    expect((await res.json()).url).toContain(`/tenants/${A}/quotes/${quoteId}/`)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-robots-tag')).toContain('noindex')
    await open(token)
    expect((await eventsOf(quoteId)).filter((e) => e === 'link_opened')).toHaveLength(1)
  })

  it('a malformed, missing, unknown, expired or revoked token is the same 404', async () => {
    const { quoteId, token } = await linked()
    for (const bad of ['nope', 'a'.repeat(43), null, 42]) expect((await open(bad)).status).toBe(404)
    await db('sales_quote_deliveries').where({ quoteId }).update({ linkExpiresAt: new Date(Date.now() - 1000) })
    expect((await open(token)).status).toBe(404)
    await db('sales_quote_deliveries').where({ quoteId }).update({ linkExpiresAt: new Date(Date.now() + 1e7), linkRevokedAt: new Date() })
    expect((await open(token)).status).toBe(404)
  })

  it('a quote no longer out with the customer does not open', async () => {
    const { quoteId, token } = await linked()
    await db('sales_quotes').where({ id: quoteId }).update({ status: 'declined', decidedAt: new Date() })
    expect((await open(token)).status).toBe(404)
  })

  it('turning the agency’s send switch off disables every link at once (the kill switch)', async () => {
    const { token } = await linked()
    delete process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS
    expect((await open(token)).status).toBe(404)
    process.env.WA_ASSISTANT_QUOTES_SEND_AGENCY_IDS = `${A},${B}`
    expect((await open(token)).status).toBe(200)
  })

  it('one tenant’s token opens only its own document', async () => {
    const { quoteId, token } = await linked()
    const foreign = await owner(B)
    const other = await reviewing(foreign)
    await tap(foreign, other.buttons[0])
    const url = (await (await open(token)).json()).url as string
    expect(url).toContain(`/tenants/${A}/quotes/${quoteId}/`)
    expect(url).not.toContain(`/tenants/${B}/`)
  })
})

describe('what counts as asking to review', () => {
  it.each([
    ['תראה לי שוב את ההצעה', true],
    ['תשלח את ההצעה ללקוח', true],
    ['תכין הצעת מחיר לדוד', false],
    ['תשנה את ההצעה ל-500', false],
    ['תראה לי את הלידים', false],
    ['תשלח לדוד הודעה', false],
  ])('%s', (text, expected) => expect(asksToReviewQuote(text)).toBe(expected))
})
