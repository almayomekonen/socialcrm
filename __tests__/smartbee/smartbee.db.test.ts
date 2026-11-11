import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SmartBee documents end to end against a real (local test) PostgreSQL: the
 * owner's WhatsApp message → the worker → a card → a tap → the REAL Action
 * Runtime and `create_smartbee_document` executor → the stored request → the
 * follow-up against a FAKE SmartBee (mocked fetch) → one notice to the owner.
 * Only the model, Meta and SmartBee's HTTP are mocked; nothing leaves the
 * process. Same harness as __tests__/waAssistant/quotes.db.test.ts.
 *
 * NOTE: over the 250-line soft limit on purpose, like quotes.db.test.ts: one
 * flat list of independent scenarios over one shared harness.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { DOCUMENT_COPY } from '@/lib/waAssistant/smartbee/copy'
import { followSmartbeeDocument, sweepSmartbeeDocuments } from '@/lib/waAssistant/smartbee/follow'
import { createSmartbeeDocumentAction } from '@/lib/agent/actions/domain/createSmartbeeDocument'
import { saveSmartbeeConnection, loadSmartbeeConnection } from '@/db/smartbee/connections'
import { findSmartbeeDocument } from '@/db/smartbee/documents'
import { advanceSmartbeeDocument } from '@/lib/integrations/providers/smartbee/lifecycle'
import { resolveIntegrationAccess } from '@/lib/integrations/core/permissions'
import { externalDocumentIssuer } from '@/lib/integrations/core/registry'
import { __resetSmartbeeTokenCache } from '@/lib/integrations/providers/smartbee/auth'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number // SmartBee agency
let B: number // any other agency
let X: number // SmartBee agency registered as עוסק פטור
let seq = 0
type Owner = { u: number; r: number; digits: string; lead: number }

async function lead(agencyId: number, userId: number) {
  const [c] = await db('clients').insert({ firstName: 'יוסי', lastName: 'כהן', agencyId, userId, createdById: userId, lead: true, status: 'new' }).returning('id')
  return Number(c.id)
}
async function owner(agencyId: number, role = 'ADMIN'): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000083${String(++seq).padStart(2, '0')}`
  return { u, r: await recipient(agencyId, u, digits, undefined, 'v4'), digits, lead: await lead(agencyId, u) }
}

const docProposal = (clientId: number, over: Record<string, unknown> = {}) => ({
  actionType: 'create_smartbee_document' as const,
  args: { clientId, docType: 'InvoiceReceipt', description: 'צילום חתונה', amount: 1500, priceBasis: 'incl_vat', paymentMethod: 'cash', paymentLabel: null, checkNumber: null, transferReference: null, installments: null, ...over },
})
const answer = (p: ReturnType<typeof docProposal>, leads: number[]) => ({
  ok: true as const,
  answer: { headline: 'ביקשתי', claims: [], unknown: null, proposedAction: { ...p, evidenceRefs: leads.map((l) => `lead:${l}`) } },
  evidence: leads.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_sb_${++seq}`,
  costUsd: 0.01,
})

function harness(results: unknown[] = []) {
  const runAgent = vi.fn(async (_input: Record<string, any>) => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.SB_${++seq}` }))
  const follow = vi.fn()
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never, documents: { decide: { follow: follow as never } } }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[]; toE164: string }
  return { runAgent, sendText, follow, deps, last }
}
const msg = (from: string, extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__sb_${++seq}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)
const say = (o: Owner, body: string) => msg(o.digits, { type: 'text', text: { body } })
const tap = (o: Owner, id: string) => msg(o.digits, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })
const run = (h: ReturnType<typeof harness>) => runWaAssistantWorker({}, h.deps)
const docsOf = (agencyId: number) => db('smartbee_documents').where({ agencyId }).orderBy('id')

/** A fake SmartBee: answers in order; records every request. */
type Call = { url: string; method: string; body: any }
function smartbee(...replies: (() => Response)[]) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = replies.shift()
    if (!next) throw new Error(`unexpected SmartBee request ${url}`)
    return next()
  })
  return { calls, auth: { fetchImpl: fetchImpl as unknown as typeof fetch } }
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 })
const LOGIN = ok({ token: 'jwt', expirationUtcDate: new Date(Date.now() + 6 * 864e5).toISOString() })
const code = (resultCodeId: number, result: unknown = null) => ok({ resultCodeId, result, validationErrors: null })
const CREATED = code(102, { docType: 'InvoiceReceipt', documentId: 'doc-77', index: 1045, taxConfirmationNumber: '202611100001', linkToOriginal: 'https://test.smartbee.co.il/public/files/x/y/1_Original.pdf', linkToCopy: 'https://c' })

/** A clock that moves only when the follow-up sleeps, so SmartBee's poll schedule runs instantly. */
function clock() {
  let t = Date.now()
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

const REQUEST = 'תפיק חשבונית מס קבלה ליוסי כהן על צילום חתונה, 1,500 שקל כולל מע"מ, שולם במזומן'

async function approvedRow(o: Owner, h: ReturnType<typeof harness>) {
  await say(o, REQUEST)
  await run(h)
  const approve = h.last().buttons![0].id
  await tap(o, approve)
  await run(h)
  const [row] = await docsOf(A)
  return { row, approve }
}

beforeAll(async () => {
  A = await agency('__sb_a__')
  B = await agency('__sb_b__')
  X = await agency('__sb_x__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('smartbee_documents').whereIn('agencyId', [A, B, X]).del()
  await db('smartbee_connections').whereIn('agencyId', [A, B, X]).del()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('agencies').whereIn('id', [A, B, X]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  __resetSmartbeeTokenCache()
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B},${X}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B},${X}`
  process.env.SMARTBEE_AGENCY_IDS = `${A},${X}`
  process.env.SMARTBEE_TEST_CLIENT_ID = 'client'
  process.env.SMARTBEE_TEST_CLIENT_PASSWORD = 'pw'
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'SMARTBEE_AGENCY_IDS', 'SMARTBEE_TEST_CLIENT_ID', 'SMARTBEE_TEST_CLIENT_PASSWORD', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN'])
    delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('smartbee_documents').whereIn('agencyId', [A, B, X]).del()
  await db('smartbee_connections').whereIn('agencyId', [A, B, X]).del()
  await db('analytics_events').whereIn('agencyId', [A, B, X]).del()
  await db('clients').whereIn('agencyId', [A, B, X]).del()
  await cleanup()
})

const connect = (agencyId: number, ownerUserId: number, businessType: 'exempt' | 'authorized' = 'authorized') =>
  saveSmartbeeConnection({ agencyId, ownerUserId, environment: 'test', businessType, providerUserToken: `biz-token-${agencyId}`, verifiedAt: new Date() })

describe('owner → card → approval → SmartBee confirms → one notice', () => {
  it('the full flow, with every safeguard visible', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(docProposal(o.lead), [o.lead])])

    await say(o, REQUEST)
    await run(h)
    expect(h.runAgent.mock.calls[0][0].answerSchema).toBeDefined()
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).toContain('create_smartbee_document')
    const card = h.last()
    for (const s of ['*להפיק חשבונית מס קבלה ב-SmartBee?*', 'סביבת בדיקות', 'לקוח: יוסי כהן', 'תיאור: צילום חתונה', 'סכום: ₪1,500.00 כולל מע"מ', 'תשלום: ₪1,500.00 במזומן', 'התשלום הזה התקבל בפועל', 'הוא לא יישלח ללקוח'])
      expect(card.body).toContain(s)
    expect(card.buttons!.map((b) => b.title)).toEqual(['לאשר ולהפיק', 'ביטול'])
    expect(await docsOf(A)).toHaveLength(0)

    await tap(o, card.buttons![0].id)
    await run(h)
    expect(h.last().body).toContain('ממתינה לאישור שלהם')
    expect(h.last().body).not.toContain('הופקה')
    const [action] = await db('agent_actions').where({ agencyId: A, actionType: 'create_smartbee_document' })
    const [row] = await docsOf(A)
    expect(row).toMatchObject({ status: 'pending', docType: 'InvoiceReceipt', leadId: o.lead, approvedByUserId: o.u, providerMsgId: `scrm-test-${action.actionId}`, environment: 'test' })
    expect(row.payment).toEqual({ method: 'cash', amount: 1500, paidOn: null, installments: null, checkNumber: null, reference: null, otherLabel: null })
    expect(row.approvedAt).toBeTruthy()
    expect(JSON.stringify(row.requestSnapshot)).not.toContain('biz-token')
    expect(h.follow).toHaveBeenCalledTimes(1)

    const sb = smartbee(LOGIN, code(101, 'msg-1'), code(1), CREATED)
    const status = await followSmartbeeDocument({ agencyId: A, documentId: Number(row.id), deps: { lifecycle: { auth: sb.auth }, notice: { send: h.sendText as never }, ...clock() } })
    expect(status).toBe('created')
    const create = sb.calls.find((c) => c.url.endsWith('/documents/create'))!
    expect(create.body).toMatchObject({ providerUserToken: `biz-token-${A}`, providerMsgId: row.providerMsgId, creationMetadata: { sendOriginalToCustomer: false } })
    expect(sb.calls.every((c) => c.url.startsWith('https://test.smartbee.co.il/api/v1/'))).toBe(true)
    const done = await findSmartbeeDocument(A, Number(row.id))
    expect(done).toMatchObject({ status: 'created', apiMessageId: 'msg-1', documentId: 'doc-77', docIndex: '1045', taxConfirmationNumber: '202611100001', noticeState: 'sent' })
    const notice = h.last()
    expect(notice.toE164).toBe(`+${o.digits}`)
    for (const s of ['הופקה ב-SmartBee', 'מספר מסמך: 1045', 'מספר הקצאה: 202611100001', '1_Original.pdf', 'לא נשלח ללקוח']) expect(notice.body).toContain(s)
    // Every message went to the owner only.
    expect(h.sendText.mock.calls.every(([i]) => i.toE164 === `+${o.digits}`)).toBe(true)

    // Nothing more: the row is terminal and the notice is claimed.
    const again = smartbee()
    expect(await followSmartbeeDocument({ agencyId: A, documentId: Number(row.id), deps: { lifecycle: { auth: again.auth }, notice: { send: h.sendText as never } } })).toBe('skipped')
    expect(await sweepSmartbeeDocuments({ deps: { lifecycle: { auth: again.auth }, notice: { send: h.sendText as never } } })).toEqual({ advanced: 0, notified: 0 })
    expect(again.calls).toHaveLength(0)

    // The same button again: single-use.
    await tap(o, card.buttons![0].id)
    await run(h)
    expect(h.last().body).toBe(DOCUMENT_COPY.alreadyDecided)
    expect(await docsOf(A)).toHaveLength(1)
  })

  it('a timeout re-sends the SAME providerMsgId; SmartBee 95 returns the original; one document', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(docProposal(o.lead), [o.lead])])
    const { row } = await approvedRow(o, h)
    const connection = await loadSmartbeeConnection(A)
    const timeout = () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' })
    }
    const sb = smartbee(LOGIN, timeout, code(95, 'msg-original'))
    const first = await advanceSmartbeeDocument((await findSmartbeeDocument(A, Number(row.id)))!, connection, Date.now(), { auth: sb.auth })
    expect(first).toMatchObject({ status: 'pending', submitAttempts: 1, failureReason: 'transport_timeout' })
    const second = await advanceSmartbeeDocument(first, connection, Date.now() + 20_000, { auth: sb.auth })
    expect(second).toMatchObject({ status: 'queued', apiMessageId: 'msg-original', resultCode: 95 })
    const creates = sb.calls.filter((c) => c.url.endsWith('/documents/create'))
    expect(creates).toHaveLength(2)
    expect(creates[0].body.providerMsgId).toBe(row.providerMsgId)
    expect(creates[1].body.providerMsgId).toBe(row.providerMsgId)
    expect(await docsOf(A)).toHaveLength(1)
  })

  it('SmartBee 98 marks the connection invalid; nothing more is offered or sent', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(docProposal(o.lead), [o.lead])])
    const { row } = await approvedRow(o, h)
    const sb = smartbee(LOGIN, code(98))
    await followSmartbeeDocument({ agencyId: A, documentId: Number(row.id), deps: { lifecycle: { auth: sb.auth }, notice: { send: h.sendText as never }, ...clock() } })
    expect(await findSmartbeeDocument(A, Number(row.id))).toMatchObject({ status: 'failed', failureReason: 'invalid_provider_token', noticeState: 'sent' })
    expect(h.last().body).toContain('לא הופקה')
    expect((await loadSmartbeeConnection(A))!.status).toBe('invalid')
    expect(await resolveIntegrationAccess({ provider: 'smartbee', agencyId: A, userId: o.u })).toEqual({ ok: false, reason: 'connection_inactive' })
  })

  it('a receipt with no payment method asks; nothing is recorded', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(docProposal(o.lead, { docType: 'Receipt', paymentMethod: null }), [o.lead])])
    await say(o, 'תוציא קבלה ליוסי כהן על צילום חתונה, 1,500 שקל')
    await run(h)
    expect(h.last().body).toBe(DOCUMENT_COPY.askPayment)
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(0)
  })

  it('an עוסק פטור cannot issue an invoice', async () => {
    const o = await owner(X)
    await connect(X, o.u, 'exempt')
    const h = harness([answer(docProposal(o.lead), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.last().body).toBe(DOCUMENT_COPY.typeNotAllowed)
  })
})

describe('only the authorized agency, only its owner', () => {
  it('another agency is never offered the action, and a forged proposal does nothing', async () => {
    const o = await owner(B)
    await connect(B, o.u) // even a stored connection does not open it without the allowlist
    const h = harness([answer(docProposal(o.lead), [o.lead])])
    await say(o, REQUEST)
    await run(h)
    expect(h.runAgent.mock.calls[0][0].answerSchema).toBeUndefined()
    expect(String(h.runAgent.mock.calls[0][0].surfaceRules)).not.toContain('create_smartbee_document')
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await db('agent_actions').where({ agencyId: B })).toHaveLength(0)
    expect(await docsOf(B)).toHaveLength(0)
  })

  it('a second admin of the SAME agency is refused: only the connection owner', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const other = await owner(A)
    const h = harness([answer(docProposal(other.lead), [other.lead])])
    await say(other, REQUEST)
    await run(h)
    expect(h.last().body).toBe(DOCUMENT_COPY.notOwner)
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(0)
  })

  it('the executor re-checks: another agency is NOT_AUTHORIZED; a re-run never makes a second row', async () => {
    const o = await owner(A)
    const conn = await connect(A, o.u)
    const args = { clientId: o.lead, docType: 'Receipt', description: 'צילום', amount: 200, vatOption: null, payment: { method: 'cash', amount: 200, paidOn: null, installments: null, checkNumber: null, reference: null, otherLabel: null }, customerName: 'יוסי כהן', customerIdNumber: null, connectionId: conn, environment: 'test' }
    const action = { actionId: `act_sb_${++seq}`, args } as never
    const ctx = (agencyId: number, userId: number) => ({ actor: { agencyId, userId, role: 'ADMIN', gotPermIds: [] }, nowMs: Date.now(), deadlineAtMs: Date.now() + 30_000 })
    const intruder = await owner(B)
    expect(await createSmartbeeDocumentAction.execute(action, ctx(B, intruder.u))).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'smartbee-agency_not_allowed' })
    const first = await createSmartbeeDocumentAction.execute(action, ctx(A, o.u))
    const second = await createSmartbeeDocumentAction.execute(action, ctx(A, o.u))
    expect(first.status).toBe('SUCCESS')
    expect(second.targetIds).toEqual(first.targetIds)
    expect(await docsOf(A)).toHaveLength(1)
    const id = Number(first.targetIds![0].id)
    expect(await findSmartbeeDocument(B, id)).toBeNull()
    expect((await createSmartbeeDocumentAction.verify(action, first, ctx(A, o.u))).verified).toBe(true)
  })

  it('a production connection is refused while production is disabled', async () => {
    const o = await owner(A)
    await saveSmartbeeConnection({ agencyId: A, ownerUserId: o.u, environment: 'production', businessType: 'authorized', providerUserToken: 'p', verifiedAt: new Date() })
    expect(await resolveIntegrationAccess({ provider: 'smartbee', agencyId: A, userId: o.u })).toEqual({ ok: false, reason: 'production_disabled' })
  })
})

describe('native billing is blocked for the SmartBee agency only', () => {
  it('allowlisted or ever connected → SmartBee issues; everyone else → native', async () => {
    const o = await owner(A)
    expect(await externalDocumentIssuer(A)).toBe('smartbee')
    expect(await externalDocumentIssuer(B)).toBeNull()
    await connect(A, o.u)
    process.env.SMARTBEE_AGENCY_IDS = ''
    expect(await externalDocumentIssuer(A)).toBe('smartbee') // a live connection keeps native closed
    await db('smartbee_connections').where({ agencyId: A }).update({ status: 'disconnected' })
    expect(await externalDocumentIssuer(A)).toBe('smartbee') // the row is the designation, whatever its status
    expect(await externalDocumentIssuer(B)).toBeNull()
  })
})

describe('schema', () => {
  it('a receipt row without the confirmed payment is rejected by the database', async () => {
    const o = await owner(A)
    const conn = await connect(A, o.u)
    await expect(
      db('smartbee_documents').insert({ agencyId: A, connectionId: conn, agentActionId: `x_${++seq}`, environment: 'test', providerMsgId: `p_${seq}`, docType: 'Receipt', description: 'd', totalAmount: 1, requestSnapshot: '{}', approvedByUserId: o.u, approvedAt: new Date() }),
    ).rejects.toThrow(/smartbee_documents_receipt_has_payment/)
  })
})
