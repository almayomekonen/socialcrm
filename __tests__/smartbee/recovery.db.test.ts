import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SmartBee recovery, exclusion and approval-integrity rules against a real
 * (local test) PostgreSQL, with a FAKE SmartBee (mocked fetch). Grew out of the
 * 2026-11-10 security audit: every scenario here is one the audit named.
 *
 * NOTE: over the 250-line soft limit on purpose, like smartbee.db.test.ts: one
 * flat list of independent scenarios over one shared harness.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { _setSmartbeePermittedAgencyIdsForTests } from '@/lib/flags/smartbeeFlags'
import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { DOCUMENT_COPY, RESOLVE_COPY } from '@/lib/waAssistant/smartbee/copy'
import { groundedProposal } from '@/lib/agent/proposalGate'
import { sweepSmartbeeDocuments } from '@/lib/waAssistant/smartbee/follow'
import { saveSmartbeeConnection, loadSmartbeeConnection } from '@/db/smartbee/connections'
import { findSmartbeeDocument } from '@/db/smartbee/documents'
import { GIVE_UP_MS, advanceSmartbeeDocument } from '@/lib/integrations/providers/smartbee/lifecycle'
import { externalDocumentIssuer } from '@/lib/integrations/core/registry'
import { __resetSmartbeeTokenCache } from '@/lib/integrations/providers/smartbee/auth'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require('../../migrations/20261113140000_smartbee_integration.cjs') as { down: (k: unknown) => Promise<void> }

let A: number
let B: number
let seq = 0
type Owner = { u: number; digits: string; lead: number }
/** Lead ID numbers are unique per agency (clients_idNum_agencyId_unique): one per fixture. */
const nextIdNum = () => `05550${String(++seq).padStart(4, '0')}`
async function owner(agencyId: number, idNum: string | null = nextIdNum()): Promise<Owner> {
  const u = await user(agencyId, 'ADMIN')
  const digits = `9725000091${String(++seq).padStart(2, '0')}`
  await recipient(agencyId, u, digits, undefined, 'v4')
  const [c] = await db('clients').insert({ firstName: 'יוסי', lastName: 'כהן', idNum, agencyId, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  return { u, digits, lead: Number(c.id) }
}
const answer = (clientId: number) => ({
  ok: true as const,
  answer: {
    headline: 'x',
    claims: [],
    unknown: null,
    proposedAction: {
      actionType: 'create_smartbee_document',
      args: { clientId, docType: 'InvoiceReceipt', description: 'צילום חתונה', amount: 1500, priceBasis: 'incl_vat', paymentMethod: 'cash', paymentLabel: null, checkNumber: null, transferReference: null, installments: null },
      evidenceRefs: [`lead:${clientId}`],
    },
  },
  evidence: [{ kind: 'lead', refId: String(clientId) }],
  steps: 1,
  stopReason: 'answered' as const,
  investigationId: `inv_rec_${++seq}`,
  costUsd: 0,
})
function harness(results: unknown[]) {
  const runAgent = vi.fn(async () => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.RC_${++seq}` }))
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never, documents: { decide: { follow: vi.fn() as never } } }
  return { sendText, deps, last: () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string }[] } }
}
const msg = (from: string, extra: Record<string, unknown>) => processPlatformMessage({ id: `wamid.__rc_${++seq}`, from, timestamp: String(Math.floor(Date.now() / 1000)), ...extra } as never)
const tap = (digits: string, id: string) => msg(digits, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })
const REQUEST = 'תפיק חשבונית מס קבלה ליוסי כהן על צילום חתונה, 1,500 שקל כולל מע"מ, שולם במזומן'
const ok = (b: unknown) => () => new Response(JSON.stringify(b), { status: 200 })
const LOGIN = ok({ token: 'jwt', expirationUtcDate: new Date(Date.now() + 6 * 864e5).toISOString() })
const code = (resultCodeId: number, result: unknown = null) => ok({ resultCodeId, result, validationErrors: null })
const timeout = () => {
  throw Object.assign(new Error('t'), { name: 'TimeoutError' })
}
function smartbee(...replies: (() => Response)[]) {
  const calls: { url: string; body: any }[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const next = replies.shift()
    if (!next) throw new Error(`unexpected ${url}`)
    return next()
  })
  return { calls, creates: () => calls.filter((c) => c.url.endsWith('/documents/create')), auth: { fetchImpl: fetchImpl as unknown as typeof fetch } }
}
async function cardFor(o: Owner, h: ReturnType<typeof harness>) {
  await msg(o.digits, { type: 'text', text: { body: REQUEST } })
  await runWaAssistantWorker({}, h.deps)
  return h.last()
}
async function approved(o: Owner, h = harness([answer(o.lead)])) {
  await tap(o.digits, (await cardFor(o, h)).buttons![0].id)
  await runWaAssistantWorker({}, h.deps)
  return (await db('smartbee_documents').where({ agencyId: A }).orderBy('id', 'desc').first())!
}
const connect = (agencyId: number, ownerUserId: number) => saveSmartbeeConnection({ agencyId, ownerUserId, environment: 'test', businessType: 'authorized', providerUserToken: `t-${agencyId}`, verifiedAt: new Date() })
const reload = async (id: number) => (await findSmartbeeDocument(A, id))!

/** One timed-out submit: the request MAY now exist at SmartBee. */
async function uncertain(o: Owner) {
  await connect(A, o.u)
  const row = await approved(o)
  const sb = smartbee(LOGIN, timeout)
  const pending = await advanceSmartbeeDocument(await reload(Number(row.id)), await loadSmartbeeConnection(A), Date.now(), { auth: sb.auth })
  expect(pending).toMatchObject({ status: 'pending', submitAttempts: 1, failureReason: 'transport_timeout' })
  return { row, pending, firstId: sb.creates()[0].body.providerMsgId as string }
}

beforeAll(async () => {
  A = await agency('__rc_a__')
  B = await agency('__rc_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('smartbee_documents').whereIn('agencyId', [A, B]).del()
  await db('smartbee_connections').whereIn('agencyId', [A, B]).del()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('agencies').whereIn('id', [A, B]).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  __resetSmartbeeTokenCache()
  Object.assign(process.env, {
    WA_ASSISTANT_AGENCY_IDS: `${A},${B}`,
    OWNER_WA_REMINDERS_AGENCY_IDS: `${A},${B}`,
    SMARTBEE_AGENCY_IDS: `${A}`,
    SMARTBEE_TEST_CLIENT_ID: 'c',
    SMARTBEE_TEST_CLIENT_PASSWORD: 'p',
    PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PLATFORM,
    PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN,
  })
  // The suite's own agency stands in for the pinned one (agency 167 in Production).
  _setSmartbeePermittedAgencyIdsForTests([A])
})
afterAll(async () => {
  _setSmartbeePermittedAgencyIdsForTests(null)
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('smartbee_documents').whereIn('agencyId', [A, B]).del()
  await db('smartbee_connections').whereIn('agencyId', [A, B]).del()
  await db('analytics_events').whereIn('agencyId', [A, B]).del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('an uncertain request is never reported as not created', () => {
  it.each([
    ['disconnected', { status: 'disconnected' }, 'blocked_connection_inactive'],
    ['invalid', { status: 'invalid' }, 'blocked_connection_inactive'],
    ['another environment', { environment: 'production' }, 'blocked_environment_changed'],
  ])('timeout, then the connection is %s → still pending, same providerMsgId, nothing sent', async (_label, change, reason) => {
    const o = await owner(A)
    const { row, pending, firstId } = await uncertain(o)
    await db('smartbee_connections').where({ agencyId: A }).update(change)
    const sb = smartbee()
    const after = await advanceSmartbeeDocument(pending, await loadSmartbeeConnection(A), Date.now() + 60_000, { auth: sb.auth })
    expect(after).toMatchObject({ status: 'pending', failureReason: reason, providerMsgId: row.providerMsgId, submitAttempts: 1 })
    expect(firstId).toBe(row.providerMsgId)
    expect(sb.calls).toHaveLength(0)
  })

  it('timeout, then SmartBee 98 on the retry → pending (the first request may exist), connection marked invalid', async () => {
    const o = await owner(A)
    const { row, pending } = await uncertain(o)
    __resetSmartbeeTokenCache() // a fresh fake SmartBee: it logs in again
    const sb = smartbee(LOGIN, code(98))
    const after = await advanceSmartbeeDocument(pending, await loadSmartbeeConnection(A), Date.now() + 20_000, { auth: sb.auth })
    expect(after).toMatchObject({ status: 'pending', failureReason: 'blocked_invalid_provider_token', providerMsgId: row.providerMsgId })
    expect((await loadSmartbeeConnection(A))!.status).toBe('invalid')
  })

  it('the connection comes back → the sweep resumes with the SAME providerMsgId; 95 returns the original; 102 → one notice', async () => {
    const o = await owner(A)
    const { row, pending } = await uncertain(o)
    await db('smartbee_connections').where({ agencyId: A }).update({ status: 'disconnected' })
    await advanceSmartbeeDocument(pending, await loadSmartbeeConnection(A), Date.now() + 20_000)
    await db('smartbee_connections').where({ agencyId: A }).update({ status: 'active' })
    const h = harness([])
    __resetSmartbeeTokenCache() // a fresh fake SmartBee: it logs in again
    const sb = smartbee(LOGIN, code(95, 'm-orig'), code(102, { documentId: 'd', index: 9, linkToOriginal: 'https://o' }))
    const deps = (ms: number) => ({ lifecycle: { auth: sb.auth }, notice: { send: h.sendText as never }, now: () => Date.now() + ms })
    expect(await sweepSmartbeeDocuments({ deps: deps(10 * 60_000) })).toMatchObject({ advanced: 1 })
    expect(await sweepSmartbeeDocuments({ deps: deps(11 * 60_000) })).toEqual({ advanced: 1, notified: 1 })
    expect(sb.creates().map((c) => c.body.providerMsgId)).toEqual([row.providerMsgId])
    expect(await reload(Number(row.id))).toMatchObject({ status: 'created', apiMessageId: 'm-orig', docIndex: '9' })
    expect(await db('smartbee_documents').where({ agencyId: A })).toHaveLength(1)
  })

  it('a request that was NEVER sent, with the connection gone → honestly failed, nothing sent', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const row = await approved(o)
    await db('smartbee_connections').where({ agencyId: A }).update({ status: 'disconnected' })
    const sb = smartbee()
    expect(await advanceSmartbeeDocument(await reload(Number(row.id)), await loadSmartbeeConnection(A), Date.now(), { auth: sb.auth })).toMatchObject({ status: 'failed', failureReason: 'connection_inactive' })
    expect(sb.calls).toHaveLength(0)
  })

  it('SmartBee 97 on a poll is uncertain: polled again, then stalled with an "unconfirmed, check SmartBee" notice', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const row = await approved(o)
    const conn = await loadSmartbeeConnection(A)
    const queued = await advanceSmartbeeDocument(await reload(Number(row.id)), conn, Date.now(), { auth: smartbee(LOGIN, code(101, 'm1')).auth })
    const polled = await advanceSmartbeeDocument(queued, conn, Date.now(), { auth: smartbee(code(97)).auth })
    expect(polled).toMatchObject({ status: 'queued', resultCode: 97 })
    const h = harness([])
    const stalled = await advanceSmartbeeDocument(polled, conn, Date.now() + GIVE_UP_MS + 1)
    expect(stalled.status).toBe('stalled')
    expect(await sweepSmartbeeDocuments({ deps: { notice: { send: h.sendText as never } } })).toMatchObject({ notified: 1 })
    expect(h.last().body).toContain('לא ידוע אם ה')
    expect(h.last().body).toContain('יש לבדוק בחשבון ה-SmartBee')
    expect(h.last().body).not.toContain('לא נוצר מסמך')
  })

  it('cron recovery: the after() follow-up never ran; the sweep submits the stored id, polls to 102, notifies once', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(o.lead)])
    const row = await approved(o, h)
    const sb = smartbee(LOGIN, code(101, 'm1'), code(102, { documentId: 'd', index: 7, linkToOriginal: 'https://o' }))
    const deps = { lifecycle: { auth: sb.auth }, notice: { send: h.sendText as never } }
    expect(await sweepSmartbeeDocuments({ deps })).toEqual({ advanced: 1, notified: 0 })
    expect(await sweepSmartbeeDocuments({ deps: { ...deps, now: () => Date.now() + 5_000 } })).toEqual({ advanced: 1, notified: 1 })
    expect(sb.creates()[0].body.providerMsgId).toBe(row.providerMsgId)
  })

  it('crash mid-send: the attempt is counted BEFORE the request, so the row is never treated as unsent', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const row = await approved(o)
    const crash = vi.fn(async () => {
      throw new Error('process died')
    })
    await expect(advanceSmartbeeDocument(await reload(Number(row.id)), await loadSmartbeeConnection(A), Date.now(), { create: crash as never })).rejects.toThrow('process died')
    expect(await reload(Number(row.id))).toMatchObject({ status: 'pending', submitAttempts: 1 })
    await db('smartbee_connections').where({ agencyId: A }).update({ status: 'invalid' })
    expect(await advanceSmartbeeDocument(await reload(Number(row.id)), await loadSmartbeeConnection(A), Date.now())).toMatchObject({ status: 'pending', failureReason: 'blocked_connection_inactive' })
  })

  it('no second document for a lead while the first is unsettled', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    await approved(o)
    const h = harness([answer(o.lead)])
    await cardFor(o, h)
    expect(h.last().body).toBe(DOCUMENT_COPY.inFlight)
    expect(await db('smartbee_documents').where({ agencyId: A })).toHaveLength(1)
  })
})

describe('the owner is re-checked before anything is sent', () => {
  it('owner changed after approval, never sent → not sent, failed owner_changed', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const row = await approved(o)
    await db('smartbee_connections').where({ agencyId: A }).update({ ownerUserId: await user(A, 'ADMIN') })
    const sb = smartbee()
    expect(await advanceSmartbeeDocument(await reload(Number(row.id)), await loadSmartbeeConnection(A), Date.now(), { auth: sb.auth })).toMatchObject({ status: 'failed', failureReason: 'owner_changed' })
    expect(sb.calls).toHaveLength(0)
  })
  it('owner changed after an uncertain send → kept pending, not re-sent, not failed', async () => {
    const o = await owner(A)
    const { pending } = await uncertain(o)
    await db('smartbee_connections').where({ agencyId: A }).update({ ownerUserId: await user(A, 'ADMIN') })
    const sb = smartbee()
    expect(await advanceSmartbeeDocument(pending, await loadSmartbeeConnection(A), Date.now() + 20_000, { auth: sb.auth })).toMatchObject({ status: 'pending', failureReason: 'blocked_owner_changed' })
    expect(sb.calls).toHaveLength(0)
  })
})

describe('the approved customer is the one on the document', () => {
  it('the card shows name and ID number; a lead edited before the tap does not change the request', async () => {
    const idNum = nextIdNum()
    const o = await owner(A, idNum)
    await connect(A, o.u)
    const h = harness([answer(o.lead)])
    const card = await cardFor(o, h)
    expect(card.body).toContain('לקוח: יוסי כהן')
    expect(card.body).toContain(`ת.ז. / ח.פ. של הלקוח: ${idNum}`)
    await db('clients').where({ id: o.lead }).update({ firstName: 'משה', lastName: 'לוי', idNum: nextIdNum() })
    await tap(o.digits, card.buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    const row = await db('smartbee_documents').where({ agencyId: A }).first()
    expect(row.requestSnapshot.customer).toEqual({ name: 'יוסי כהן', dealerNumber: idNum })
  })
  it('a lead with no ID number says so on the card and sends none', async () => {
    const o = await owner(A, null)
    await connect(A, o.u)
    const h = harness([answer(o.lead)])
    const card = await cardFor(o, h)
    expect(card.body).toContain('ללא ת.ז. / ח.פ. של הלקוח')
    await tap(o.digits, card.buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    expect((await db('smartbee_documents').where({ agencyId: A }).first()).requestSnapshot.customer).toEqual({ name: 'יוסי כהן' })
  })
})

describe('native billing exclusion', () => {
  it('allowlisted: blocked with the connection missing, active, invalid or disconnected', async () => {
    const o = await owner(A)
    expect(await externalDocumentIssuer(A)).toBe('smartbee')
    await connect(A, o.u)
    for (const status of ['active', 'invalid', 'disconnected']) {
      await db('smartbee_connections').where({ agencyId: A }).update({ status })
      expect(await externalDocumentIssuer(A)).toBe('smartbee')
    }
  })
  it('off the allowlist: any stored connection row still blocks; only deleting the row re-opens native', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    process.env.SMARTBEE_AGENCY_IDS = ''
    for (const status of ['active', 'invalid', 'disconnected']) {
      await db('smartbee_connections').where({ agencyId: A }).update({ status })
      expect(await externalDocumentIssuer(A)).toBe('smartbee')
    }
    await db('smartbee_connections').where({ agencyId: A }).update({ providerUserTokenEnc: 'not-decryptable' })
    expect(await externalDocumentIssuer(A)).toBe('smartbee')
    await db('smartbee_connections').where({ agencyId: A }).del()
    expect(await externalDocumentIssuer(A)).toBeNull()
  })
  it('an agency never designated keeps native billing', async () => {
    expect(await externalDocumentIssuer(B)).toBeNull()
  })
})

describe('financial records survive', () => {
  it('an agency with a SmartBee connection or documents cannot be deleted', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    await approved(o)
    await expect(db('agencies').where({ id: A }).del()).rejects.toThrow(/foreign key/)
    await db('smartbee_documents').where({ agencyId: A }).del()
    await expect(db('agencies').where({ id: A }).del()).rejects.toThrow(/foreign key/)
  })
  it('rollback refuses while a connection exists, and works on empty tables (inside a rolled-back transaction)', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    await expect(db.transaction((trx) => migration.down(trx))).rejects.toThrow(/smartbee_connections is not empty/)
    await expect(
      db.transaction(async (trx) => {
        await trx('smartbee_documents').del()
        await trx('smartbee_connections').del()
        await migration.down(trx)
        expect(await trx.schema.hasTable('smartbee_connections')).toBe(false)
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    expect(await db.schema.hasTable('smartbee_connections')).toBe(true)
    expect(await db('smartbee_connections').where({ agencyId: A })).toHaveLength(1)
  })
})

describe('tokens and payloads', () => {
  it('a card token tapped from ANOTHER verified phone does nothing', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(o.lead)])
    const button = (await cardFor(o, h)).buttons![0].id
    const thief = await owner(B)
    await tap(thief.digits, button)
    await runWaAssistantWorker({}, h.deps)
    expect(await db('smartbee_documents')).toHaveLength(0)
    expect(await db('wa_assistant_approvals').where({ agencyId: A }).first('status')).toMatchObject({ status: 'pending' })
  })
  it('the stored action args changed after the card → refused, nothing recorded', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([answer(o.lead)])
    const button = (await cardFor(o, h)).buttons![0].id
    const action = await db('agent_actions').where({ agencyId: A }).first('id', 'args')
    await db('agent_actions').where({ id: action.id }).update({ args: JSON.stringify({ ...action.args, amount: 15000 }), argsHash: 'tampered' })
    await tap(o.digits, button)
    await runWaAssistantWorker({}, h.deps)
    expect(h.last().body).toBe(DOCUMENT_COPY.changed)
    expect(await db('smartbee_documents')).toHaveLength(0)
  })
})

describe('a stalled document blocks its lead until the OWNER resolves it', () => {
  /** An approved request whose SmartBee outcome was never confirmed, stalled by the sweep 24 h later. */
  async function stalledFor(o: Owner, h = harness([])) {
    await connect(A, o.u)
    const row = await approved(o)
    await db('smartbee_documents').where({ id: row.id }).update({ createdAt: new Date(Date.now() - GIVE_UP_MS - 60_000) })
    expect(await sweepSmartbeeDocuments({ deps: { notice: { send: h.sendText as never } } })).toEqual({ advanced: 1, notified: 1 })
    return { row: await reload(Number(row.id)), notice: h.last() }
  }
  const say = (o: Owner, h: ReturnType<typeof harness>, body: string) => msg(o.digits, { type: 'text', text: { body } }).then(() => runWaAssistantWorker({}, h.deps))

  it('the owner is told in the SAME sweep that stalls it, with how to settle it', async () => {
    const o = await owner(A)
    const { row, notice } = await stalledFor(o)
    expect(row).toMatchObject({ status: 'stalled', noticeState: 'sent', resolution: null })
    expect(notice.body).toContain('לא ידוע אם ה')
    expect(notice.body).toContain('"המסמך קיים"')
    expect(notice.body).toContain('"המסמך לא קיים"')
  })

  it('no new document for that lead while unresolved: the card is refused and so is the executor', async () => {
    const o = await owner(A)
    await stalledFor(o)
    const h = harness([answer(o.lead)])
    await cardFor(o, h)
    expect(h.last().body).toBe(DOCUMENT_COPY.unresolved)
    expect(await db('agent_actions').where({ agencyId: A, actionType: 'create_smartbee_document' })).toHaveLength(1)
  })

  it('"המסמך קיים מספר 1045" → a card from the stored row → tap → recorded with who, when, number; no model ran', async () => {
    const o = await owner(A)
    const { row } = await stalledFor(o)
    const h = harness([])
    await say(o, h, 'בדקתי, המסמך קיים מספר 1045')
    const card = h.last()
    for (const s of ['*לסמן שהחשבונית מס קבלה קיימת ב-SmartBee?*', 'לקוח: יוסי כהן', 'סכום: ₪1,500.00', 'מספר מסמך ב-SmartBee: 1045', 'בדקת ב-SmartBee']) expect(card.body).toContain(s)
    expect(await reload(Number(row.id))).toMatchObject({ resolution: null })
    await tap(o.digits, card.buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    expect(h.last().body).toBe(RESOLVE_COPY.existsDone)
    const done = await reload(Number(row.id))
    expect(done).toMatchObject({ status: 'stalled', resolution: 'exists', resolvedDocIndex: '1045', resolvedByUserId: o.u })
    expect(done.resolvedAt).toBeTruthy()
    const [action] = await db('agent_actions').where({ agencyId: A, actionType: 'resolve_smartbee_document' })
    expect((done as { resolutionActionId: string }).resolutionActionId).toBe(action.actionId)
    // The same button again: single-use.
    await tap(o.digits, card.buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    expect(h.last().body).toBe(DOCUMENT_COPY.alreadyDecided)
  })

  it('"המסמך לא קיים" → approved → the block is released and a new document can be requested', async () => {
    const o = await owner(A)
    const { row } = await stalledFor(o)
    const h = harness([answer(o.lead)])
    await say(o, h, 'המסמך לא קיים')
    await tap(o.digits, h.last().buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    expect(h.last().body).toBe(RESOLVE_COPY.absentDone)
    expect(await reload(Number(row.id))).toMatchObject({ resolution: 'absent', resolvedDocIndex: null, resolvedByUserId: o.u })
    const card = await cardFor(o, h)
    expect(card.buttons).toHaveLength(2)
  })

  it('the words alone record nothing; "ביטול" on the card records nothing', async () => {
    const o = await owner(A)
    const { row } = await stalledFor(o)
    const h = harness([])
    await say(o, h, 'המסמך קיים')
    await tap(o.digits, h.last().buttons![1].id)
    await runWaAssistantWorker({}, h.deps)
    expect(h.last().body).toBe(RESOLVE_COPY.rejected)
    expect(await reload(Number(row.id))).toMatchObject({ resolution: null })
  })

  it('another admin of the same agency cannot resolve it', async () => {
    const o = await owner(A)
    const { row } = await stalledFor(o)
    const other = await owner(A)
    const h = harness([])
    await say(other, h, 'המסמך לא קיים')
    expect(h.last().body).toBe(RESOLVE_COPY.notOwner)
    expect(await db('agent_actions').where({ agencyId: A, actionType: 'resolve_smartbee_document' })).toHaveLength(0)
    expect(await reload(Number(row.id))).toMatchObject({ resolution: null })
  })

  it('the model can never propose a resolution: the gate drops it', () => {
    const evidence = { has: () => true } as never
    expect(groundedProposal({ actionType: 'resolve_smartbee_document', args: { clientId: 1, smartbeeDocumentId: 1, resolution: 'absent' }, evidenceRefs: [] } as never, evidence)).toBeNull()
  })

  it('with no stalled document the words are an ordinary message for the Agent', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const h = harness([{ ok: true, answer: { headline: 'שלום', claims: [], unknown: null, proposedAction: null }, evidence: [], steps: 0, stopReason: 'answered', investigationId: 'inv_x', costUsd: 0 }])
    await say(o, h, 'המסמך קיים')
    expect(h.last().buttons).toBeUndefined()
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(0)
  })

  it('the database refuses a resolution on a row that is not stalled, or without who/when', async () => {
    const o = await owner(A)
    await connect(A, o.u)
    const row = await approved(o)
    await expect(db('smartbee_documents').where({ id: row.id }).update({ resolution: 'absent', resolvedByUserId: o.u, resolvedAt: new Date(), resolutionActionId: 'x' })).rejects.toThrow(/resolution_only_stalled/)
    await db('smartbee_documents').where({ id: row.id }).update({ status: 'stalled' })
    await expect(db('smartbee_documents').where({ id: row.id }).update({ resolution: 'absent' })).rejects.toThrow(/resolution_recorded/)
  })
})
