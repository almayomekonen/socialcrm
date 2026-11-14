import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The customer-facing WhatsApp agent on the agency's one credit balance, through
 * the REAL webhook ingest, job queue and worker. WhatsApp and the model are
 * faked and both COUNT, so "no model call" and "nothing sent" are proven.
 */
const notify = vi.hoisted(() => ({ calls: [] as Array<{ event: string; agencyId: number }> }))
vi.mock('@/lib/payments/notifyOwner', () => ({
  notifyAgencyOwner: async (event: string, agencyId: number) => {
    notify.calls.push({ event, agencyId })
  },
}))

import { randomUUID } from 'crypto'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { admitAgentRequest } from '@/db/credits/agentRequests'
import { creditPeriodKey, insertEntry } from '@/db/credits/ledger'
import type { QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'

let sent: string[] = []
let modelCalls = 0
const send = (async (args: { body: string }) => {
  sent.push(args.body)
  return { ok: true, wamid: `wamid.out.${randomUUID()}` }
}) as never
const generateQualify = (async (): Promise<QualifyGenResult> => {
  modelCalls++
  return {
    ok: true, reply: 'מה הכי חשוב לך שנסדר?', extracted: {}, corrected: [], objective: 'discover_need',
    understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null }, salesMove: 'DISCOVERY', hotSignal: false, uncertain: false, model: 'fake',
  }
}) as never
const generate = (async () => {
  modelCalls++
  return { ok: true, message: 'תודה שפנית, נחזור אלייך בהקדם.' }
}) as never
const drain = () => runAutoResponseWorker({ deps: { send, generate, generateQualify }, workerId: `cred-${randomUUID()}` })

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function tenant(suffix: string, opts: { replyMode?: 'ai' | 'fixed'; mode?: 'qualify' | 'acknowledge' } = {}): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `עסק ${suffix}`, autoResponseEnabled: true, plan: 'pro', planReason: 'manual', trialExempt: false }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `cred_pn_${suffix}_${agencyId}`
  const customerWaId = `97256${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' })
  await db('auto_response_settings').insert({
    agencyId, channel: 'whatsapp', enabled: true, mode: opts.mode ?? 'qualify', responder: 'agent', replyMode: opts.replyMode ?? 'ai',
    fixedBody: opts.replyMode === 'fixed' ? 'תודה, נחזור אלייך.' : null, updatedBy: userId,
  })
  const [c] = await db('clients').insert({ firstName: 'דנה', lastName: 'כהן', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' }).returning('id')
  const [conv] = await db('inbox_conversations').insert({ agencyId, leadId: Number(c.id), channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId }).returning('id')
  return { agencyId, userId, leadId: Number(c.id), conversationId: Number(conv.id), phoneNumberId, customerWaId }
}
const says = (t: Tenant, body: string) =>
  ingestWhatsappInbound({
    agencyId: t.agencyId, leadId: t.leadId, businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId, customerName: 'דנה כהן',
    rawMessage: { id: `wamid.in.${randomUUID()}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
  })
/** Spend the agency's whole monthly allowance on owner requests. */
const spendAllowance = (t: Tenant) =>
  admitAgentRequest({ agencyId: t.agencyId, userId: t.userId, source: 'web', operation: { kind: 'copilot_request', id: randomUUID() }, nowMs: Date.now() })
const requests = (t: Tenant) => db('agent_requests').where({ agencyId: t.agencyId }).orderBy('id').select('operationKind', 'tier', 'source', 'userId')
const lastJob = async (t: Tenant) => (await db('auto_response_jobs').where({ conversationId: t.conversationId }).orderBy('id')).at(-1)

beforeEach(() => {
  sent = []
  modelCalls = 0
  notify.calls = []
  Object.assign(process.env, { CREDITS_METERING: '1', CREDITS_ENFORCEMENT: 'all', CREDITS_MONTHLY_ALLOWANCE: '1' })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ['CREDITS_METERING', 'CREDITS_ENFORCEMENT', 'CREDITS_MONTHLY_ALLOWANCE']) delete process.env[k]
  vi.restoreAllMocks()
})
afterAll(async () => {
  await db('agent_requests').whereIn('agencyId', agencies).del()
  // Append-only by trigger (DELETE is rejected); the credit suites clear it the same way.
  await db.raw('TRUNCATE agency_credit_ledger')
  for (const table of ['analytics_events', 'notification_jobs', 'questionnaire_sessions', 'auto_response_jobs', 'conversation_turn_classification', 'conversation_ai_state', 'conversation_analysis_jobs', 'conversation_intelligence', 'inbox_messages', 'inbox_participants', 'inbox_conversations', 'auto_response_settings']) {
    await db(table).whereIn('agencyId', agencies).del()
  }
  await db('tasks').whereIn('clientId', db('clients').select('id').whereIn('agencyId', agencies)).del()
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('the customer-facing agent spends the agency balance', () => {
  it('an answered customer turn is one request on the balance, recorded apart from the owner (source whatsapp, no user)', async () => {
    const t = await tenant('answered')
    await says(t, 'שלום, אני מתעניינת')
    await drain()
    expect(modelCalls).toBe(1)
    expect(sent).toHaveLength(1)
    expect(await requests(t)).toEqual([{ operationKind: 'auto_response_job', tier: 'free', source: 'whatsapp', userId: null }])
  })

  it('with no allowance and no credits: no model call, nothing sent, the message waits for a human, the owner is emailed', async () => {
    const t = await tenant('exhausted')
    await spendAllowance(t)
    await says(t, 'שלום, יש לי שאלה')
    await drain()
    expect(modelCalls).toBe(0)
    expect(sent).toEqual([])
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'credits_exhausted' })
    // The customer's message is persisted and visible in the inbox.
    expect(await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound' }).count({ n: '*' }).first()).toMatchObject({ n: '1' })
    expect(notify.calls).toEqual([{ event: 'credits.exhausted', agencyId: t.agencyId }])
    // No follow-up turn is queued behind a refusal.
    expect(await db('auto_response_jobs').where({ conversationId: t.conversationId, status: 'pending' })).toEqual([])
  })

  it('after credits are added, the next customer message is answered as a paid turn', async () => {
    const t = await tenant('topped-up')
    await spendAllowance(t)
    await insertEntry(db, { agencyId: t.agencyId, entryType: 'purchase_grant', amountMillis: 10_000, periodKey: creditPeriodKey(Date.now()), idempotencyKey: `charge:${randomUUID()}`, sourceKind: 'billing_charge', sourceId: '1' })
    await says(t, 'שלום')
    await drain()
    expect(modelCalls).toBe(1)
    expect(sent).toHaveLength(1)
    expect((await requests(t)).map((r) => r.tier)).toEqual(['free', 'paid'])
  })

  it('a fixed reply calls no model and is never metered, even with the balance spent', async () => {
    const t = await tenant('fixed', { mode: 'acknowledge', replyMode: 'fixed' })
    await spendAllowance(t)
    await says(t, 'שלום')
    await drain()
    expect(modelCalls).toBe(0)
    expect(sent).toEqual(['תודה, נחזור אלייך.'])
    expect((await requests(t)).map((r) => r.operationKind)).toEqual(['copilot_request'])
  })
})
