import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { sendWhatsappInteractive, sendWhatsappText } from '@/lib/whatsapp/sendMessage'
import { readOptOutStatus } from '@/db/whatsappOptOuts'
import type { QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'

/**
 * Shared harness for the Phase 0 Item 3 end-to-end tests: synthetic tenants,
 * the REAL inbound ingest and workers with the REAL gated send primitives, and
 * a stubbed Meta (`fetch`). Nothing here sends anything.
 */

const DEF = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8'))

export const graphCalls: Array<{ to: string; type: string }> = []
export const resetGraphCalls = () => void (graphCalls.length = 0)
function stubMeta() {
  resetGraphCalls()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      graphCalls.push({ to: body.to, type: body.type })
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: `wamid.out.${Math.random().toString(36).slice(2)}` }] }), headers: { get: () => null } }
    }),
  )
}

const generateQualify = (async (): Promise<QualifyGenResult> => ({
  ok: true,
  reply: 'מה הכי חשוב לך שנסדר?',
  extracted: {},
  corrected: [],
  objective: 'discover_need',
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  salesMove: 'DISCOVERY',
  hotSignal: false,
  uncertain: false,
  model: 'fake',
})) as never
const generate = (async () => ({ ok: true, reply: 'תודה שפנית, נחזור אלייך בהקדם.' })) as never

// The REAL gated primitive is the send dependency. Only Meta is stubbed.
export const drain = async () => {
  await runAutoResponseWorker({ deps: { send: sendWhatsappText, generate, generateQualify }, workerId: `oo-${Math.random()}` })
  await runQuestionnaireWorker({ deps: { send: sendWhatsappText, sendInteractive: sendWhatsappInteractive }, workerId: `oo-q-${Math.random()}` })
}

const agencies: number[] = []
export type Tenant = { agencyId: number; userId: number; leadId: number; phoneNumberId: string; secondNumberId: string; customerWaId: string }

export async function makeTenant(
  suffix: string,
  opts: { responder?: 'agent' | 'questionnaire'; mode?: 'qualify' | 'acknowledge'; replyMode?: 'ai' | 'fixed'; aiEnabled?: boolean; customerWaId?: string } = {},
): Promise<Tenant> {
  const aiEnabled = opts.aiEnabled ?? true
  const [a] = await db('agencies').insert({ name: `optout ${suffix}`, autoResponseEnabled: aiEnabled, plan: 'pro', trialExempt: true }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `oo_pn_${suffix}_${agencyId}`
  const secondNumberId = `oo_pn2_${suffix}_${agencyId}`
  const customerWaId = opts.customerWaId ?? `97254${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert([
    { user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' },
    { user_id: userId, agency_id: agencyId, phone_number_id: secondNumberId, access_token: 't' },
  ])
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: aiEnabled,
    mode: opts.mode ?? 'qualify',
    responder: opts.responder ?? 'agent',
    replyMode: opts.replyMode ?? 'ai',
    fixedBody: opts.replyMode === 'fixed' ? 'תודה, נחזור אלייך.' : null,
    questionnaire: opts.responder === 'questionnaire' ? JSON.stringify(DEF) : null,
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'כהן', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' })
    .returning('id')
  return { agencyId, userId, leadId: Number(c.id), phoneNumberId, secondNumberId, customerWaId }
}

let clock = Math.floor(Date.now() / 1000) - 600
export function says(t: Tenant, body: string, onNumber?: string, opts: { id?: string } = {}) {
  clock += 5
  return ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: onNumber ?? t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דנה כהן',
    rawMessage: { id: opts.id ?? `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(clock), type: 'text', text: { body } },
  })
}

export const jobs = (t: Tenant) => db('auto_response_jobs').where({ agencyId: t.agencyId }).orderBy('id').select('reason', 'status', 'skipReason')
export const outbound = (t: Tenant) => db('inbox_messages').where({ agencyId: t.agencyId, direction: 'outbound' }).count<{ n: string }[]>('id as n')
export const optedOut = async (t: Tenant) => (await readOptOutStatus(db, t.agencyId, `+${t.customerWaId}`)) === 'opted_out'

/** Env, Meta stub and cleanup for a test file that uses this harness. */
export function useOptOutHarness(): void {
  const saved: Record<string, string | undefined> = {}
  const ENV = ['AGENT_RELIABILITY_AGENCY_IDS', 'WA_QUESTIONNAIRE_ENABLED', 'WA_QUESTIONNAIRE_AGENCY_IDS']
  beforeAll(() => {
    for (const k of ENV) saved[k] = process.env[k]
    process.env.WA_QUESTIONNAIRE_ENABLED = '1'
    process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
  })
  beforeEach(() => {
    stubMeta()
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
  })
  afterEach(() => vi.unstubAllGlobals())
  afterAll(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    await db('whatsapp_opt_out_events').whereIn('agencyId', agencies).del()
    await db('whatsapp_opt_outs').whereIn('agencyId', agencies).del()
    for (const t of [
      'analytics_events', 'notification_jobs', 'questionnaire_sessions', 'auto_response_jobs', 'conversation_turn_classification',
      'conversation_ai_state', 'conversation_analysis_jobs', 'conversation_intelligence', 'inbox_messages', 'inbox_participants',
      'inbox_conversations', 'auto_response_settings',
    ]) {
      await db(t).whereIn('agencyId', agencies).del().catch(() => {})
    }
    await db('tasks').whereIn('clientId', db('clients').select('id').whereIn('agencyId', agencies)).del()
    await db('clients').whereIn('agencyId', agencies).del()
    await db('whatsapp_connections').whereIn('agency_id', agencies).del()
    await db('users').whereIn('agencyId', agencies).del()
    await db('agencies').whereIn('id', agencies).del()
  })
}
