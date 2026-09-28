import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { claimAutoResponseJobs } from '@/db/autoResponseJobs'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Tap-to-select, end to end against a real database. Only the Graph calls are
 * faked (text and interactive), so no real message is ever sent.
 *
 * The sample definition exercises every path: `services` is multi-select (stays
 * numbered text), `event_type` has 4 options (a list), `wedding_coverage` has 2
 * short options (reply buttons).
 */

const DEF = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8'),
)

type Out = { kind: 'text' | 'interactive'; body: string; interactive?: Record<string, any> }
let out: Out[] = []
let interactiveResult: () => SendWhatsappTextResult = () => ({ ok: true, wamid: `wamid.i.${Math.random()}` })

const send = (async (args: { body: string }) => {
  out.push({ kind: 'text', body: args.body })
  return { ok: true, wamid: `wamid.t.${Math.random().toString(36).slice(2)}` }
}) as never
const sendInteractive = (async (args: { body: string; interactive: Record<string, any> }) => {
  const r = interactiveResult()
  if (r.ok) out.push({ kind: 'interactive', body: args.body, interactive: args.interactive })
  return r
}) as never

const agencies: number[] = []
type Tenant = { agencyId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(suffix: string): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `q-int-${suffix}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_int_pn_${suffix}_${agencyId}`
  const customerWaId = `97253${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' })
  await db('auto_response_settings').insert({
    agencyId, channel: 'whatsapp', enabled: true, mode: 'acknowledge', responder: 'questionnaire',
    questionnaire: JSON.stringify(DEF), updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({ firstName: 'פונה', lastName: 'חדש', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' })
    .returning('id')
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId: Number(c.id), channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, leadId: Number(c.id), conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message. */
async function customer(t: Tenant, message: Record<string, unknown>) {
  await ingestWhatsappInbound({
    agencyId: t.agencyId, leadId: t.leadId, businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), ...message },
  })
}
const says = (t: Tenant, body: string) => customer(t, { type: 'text', text: { body } })
const taps = (t: Tenant, kind: 'button_reply' | 'list_reply', id: string, title: string) =>
  customer(t, { type: 'interactive', interactive: { type: kind, [kind]: { id, title } } })

const drain = () => runQuestionnaireWorker({ deps: { send, sendInteractive }, workerId: `t-${Math.random()}` })
const last = () => out[out.length - 1]
const session = (t: Tenant) => db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()

beforeAll(() => {
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
})
beforeEach(() => {
  out = []
  interactiveResult = () => ({ ok: true, wamid: `wamid.i.${Math.random().toString(36).slice(2)}` })
  process.env.WA_QUESTIONNAIRE_INTERACTIVE_AGENCY_IDS = 'all'
})
afterAll(async () => {
  for (const k of ['WA_QUESTIONNAIRE_ENABLED', 'WA_QUESTIONNAIRE_AGENCY_IDS', 'WA_QUESTIONNAIRE_INTERACTIVE_AGENCY_IDS']) delete process.env[k]
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('notification_jobs').whereIn('agencyId', agencies).del()
  await db('questionnaire_sessions').whereIn('agencyId', agencies).del()
  await db('auto_response_jobs').whereIn('agencyId', agencies).del()
  await db('conversation_ai_state').whereIn('agencyId', agencies).del()
  await db('conversation_intelligence').whereIn('agencyId', agencies).del()
  await db('inbox_messages').whereIn('agencyId', agencies).del()
  await db('inbox_participants').whereIn('agencyId', agencies).del()
  await db('inbox_conversations').whereIn('agencyId', agencies).del()
  await db('auto_response_settings').whereIn('agencyId', agencies).del()
  await db('tasks').whereIn('clientId', db('clients').select('id').whereIn('agencyId', agencies)).del()
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('tap-to-select, the whole path', () => {
  it('multi-select stays text; single-select becomes a list, then buttons; taps are answers', async () => {
    const t = await makeTenant('full')
    await says(t, 'היי')
    await drain()
    expect(last().kind).toBe('text') // services is multi-select
    expect(last().body).toContain('1. צילום סטילס')

    await says(t, '1,2')
    await drain()
    // event_type: 4 options → a list, ids are <stepId>.<optionId>
    expect(last().kind).toBe('interactive')
    expect(last().interactive?.type).toBe('list')
    const rows = last().interactive?.action.sections[0].rows
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['event_type.wedding', 'event_type.mitzvah', 'event_type.brit', 'event_type.other'])
    expect(last().interactive?.body.text).not.toMatch(/^\d\. /m) // numbered lines replaced by the list

    // The stored outbound keeps the numbered text, so the rep sees the options.
    const outbound = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).orderBy('sequence', 'desc').first()
    expect(outbound.text).toContain('1. חתונה')
    expect(outbound.metadata.interactive).toBe('list')

    await taps(t, 'list_reply', 'event_type.wedding', 'חתונה')
    await drain()
    // wedding_coverage: 2 short options → reply buttons
    expect(last().interactive?.type).toBe('button')
    expect(last().interactive?.action.buttons.map((b: any) => b.reply.id)).toEqual(['wedding_coverage.full', 'wedding_coverage.partial'])

    const s = await session(t)
    expect(s.answers.event_type).toEqual(['wedding'])

    // The tap shows in the inbox as the chosen answer, not "unsupported".
    const tapRow = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound', type: 'interactive' }).first()
    expect(tapRow.text).toBe('חתונה')
  })

  it('a tap on an EARLIER question is not taken as this question’s answer', async () => {
    const t = await makeTenant('stale')
    await says(t, 'היי')
    await drain()
    await says(t, '1')
    await drain() // now at event_type (list)
    await taps(t, 'list_reply', 'services.stills', 'צילום סטילס') // stale id from another step
    await drain()
    const s = await session(t)
    expect(s.currentStepId).toBe('event_type')
    expect(s.invalidCount).toBe(1)
  })

  it('typing the number still works while the list is showing', async () => {
    const t = await makeTenant('typed')
    await says(t, 'היי')
    await drain()
    await says(t, '1')
    await drain()
    await says(t, '2')
    await drain()
    expect((await session(t)).answers.event_type).toEqual(['mitzvah'])
  })

  it('a tap can never reach the AI agent: the AI worker cannot claim the job', async () => {
    const t = await makeTenant('ai')
    await says(t, 'היי')
    await drain()
    await says(t, '1')
    await drain()
    await taps(t, 'list_reply', 'event_type.brit', 'ברית או בריתה')
    const aiClaimed = await claimAutoResponseJobs(`ai-${Math.random()}`, 50)
    expect(aiClaimed.filter((j) => j.conversationId === t.conversationId)).toHaveLength(0)
    await drain()
    expect((await session(t)).answers.event_type).toEqual(['brit'])
  })

  it('if Meta rejects the interactive message, the same question goes as numbered text', async () => {
    const t = await makeTenant('fallback')
    await says(t, 'היי')
    await drain()
    interactiveResult = () => ({ ok: false, error: 'Invalid parameter', code: '100', httpStatus: 400 })
    await says(t, '1')
    await drain()
    expect(last().kind).toBe('text')
    expect(last().body).toContain('1. חתונה')
    expect((await session(t)).currentStepId).toBe('event_type')
  })

  it('a TIMEOUT is never followed by a second (text) copy: the session is parked for a person', async () => {
    const t = await makeTenant('timeout')
    await says(t, 'היי')
    await drain()
    interactiveResult = () => ({ ok: false, error: 'send-timeout', ambiguous: true })
    const before = out.length
    await says(t, '1')
    await drain()
    expect(out.length).toBe(before) // nothing further sent
    expect((await session(t)).status).toBe('needs_review')
  })

  it('without the flag every question stays numbered text', async () => {
    process.env.WA_QUESTIONNAIRE_INTERACTIVE_AGENCY_IDS = ''
    const t = await makeTenant('off')
    await says(t, 'היי')
    await drain()
    await says(t, '1')
    await drain()
    expect(out.every((o) => o.kind === 'text')).toBe(true)
  })
})
