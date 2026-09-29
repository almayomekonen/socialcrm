import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { recordHumanTakeover } from '@/lib/inbox/humanTakeover'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { TYPING_DEFER_MARGIN_MS, TYPING_DEFER_NOTE, typingDeferUntil } from '@/lib/inbox/autoresponse/questionnaire/typingDefer'
import { recordHumanTyping } from '@/db/conversationHumanPresence'

/**
 * The questionnaire and a rep's typing hold, against a real database. Only the
 * Graph call is faked.
 *
 * Production, 2026-09-29, conversation 10321: the customer answered, the next
 * question was ready, and the send guard refused `human_typing` because a rep's
 * keystroke from BEFORE that answer still had 56 ms of hold left. The job was
 * skipped, the follow-up rule saw nothing newer (`already_covered`), and the
 * customer never got the next question. These tests pin the fix: that turn is
 * deferred to just after the hold, and every other presence rule still wins.
 */

const DEF = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8'),
)

let sent: string[] = []
const send = (async (args: { body: string }) => {
  sent.push(args.body)
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(suffix: string): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `q-typing-${suffix}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_typing_pn_${suffix}_${agencyId}`
  const customerWaId = `97254${String(agencyId).padStart(7, '0')}`
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
  return { agencyId, userId, leadId: Number(c.id), conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message. */
async function customerSays(t: Tenant, body: string): Promise<void> {
  await ingestWhatsappInbound({
    agencyId: t.agencyId, leadId: t.leadId, businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
  })
}

/** The composer's keystroke heartbeat — the real writer the CRM calls. */
const repTypes = (t: Tenant) => recordHumanTyping({ conversationId: t.conversationId, agencyId: t.agencyId, userId: t.userId })

/**
 * Let the hold lapse without sleeping: move the typing timestamps and the job's
 * wake-up time back together, which is what the clock would have done.
 */
async function timePasses(t: Tenant, seconds: number): Promise<void> {
  const shift = `interval '${seconds} seconds'`
  await db.raw(
    `UPDATE conversation_ai_state SET "humanTypingAt" = "humanTypingAt" - ${shift}, "humanTypingUntil" = "humanTypingUntil" - ${shift} WHERE "conversationId" = ?`,
    [t.conversationId],
  )
  await db.raw(`UPDATE auto_response_jobs SET "notBefore" = "notBefore" - ${shift} WHERE "conversationId" = ? AND status = 'pending'`, [t.conversationId])
}

const drain = () => runQuestionnaireWorker({ deps: { send }, workerId: `t-${Math.random()}` })
const session = (t: Tenant) => db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()
const jobs = (t: Tenant) => db('auto_response_jobs').where({ conversationId: t.conversationId }).orderBy('id')
const questionnaireOutbound = (t: Tenant) =>
  db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).whereRaw(`metadata->>'kind' = 'questionnaire'`)
const inboundCount = async (t: Tenant) =>
  Number((await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound' }).count<{ count: string }[]>('id as count'))[0].count)

/** First question out, then the rep's keystroke, then the customer's answer: the production order. */
async function answerDuringPreTurnHold(t: Tenant): Promise<void> {
  await customerSays(t, 'שלום')
  await drain()
  expect(sent).toHaveLength(1)
  await repTypes(t)
  // In production the keystroke came 6.5 s before the answer. Put it clearly
  // before this turn too; a same-millisecond tie is `human_typing_this_turn`.
  await db.raw(`UPDATE conversation_ai_state SET "humanTypingAt" = "humanTypingAt" - interval '2 seconds' WHERE "conversationId" = ?`, [t.conversationId])
  await customerSays(t, '1')
}

beforeAll(() => {
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
})
beforeEach(() => {
  sent = []
})
afterAll(async () => {
  delete process.env.WA_QUESTIONNAIRE_ENABLED
  delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
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

describe('a typing hold that began before the customer answered', () => {
  it('defers the next question to just after the hold, then asks it once — no new customer message needed', async () => {
    const t = await makeTenant('race')
    await answerDuringPreTurnHold(t)
    const before = await session(t)
    const inboundBefore = await inboundCount(t)

    // The production moment: the hold is still live when the question is ready.
    const first = await drain()
    expect(first).toMatchObject({ claimed: 1, sent: 0, deferred: 1 })
    expect(sent, 'nothing is sent over a live hold').toHaveLength(1)

    const [, job] = await jobs(t)
    expect(job.status, 'deferred, not dropped').toBe('pending')
    expect(job.skipReason).toBeNull()
    expect(job.lastError).toBe(TYPING_DEFER_NOTE)
    expect(job.attempts, 'a defer is not a failed attempt').toBe(0)
    const presence = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first()
    expect(new Date(job.notBefore).getTime()).toBe(new Date(presence.humanTypingUntil).getTime() + TYPING_DEFER_MARGIN_MS)

    // Nothing of the turn was persisted, and the send claim was released.
    const held = await session(t)
    expect(held).toMatchObject({ status: 'active', version: before.version, lastConsumedSequence: before.lastConsumedSequence })
    expect(held.answers).toEqual(before.answers)
    expect(held.pendingTransition).toBeNull()

    // Before the hold lapses, the job is not claimable: no polling, no early send.
    expect(await drain()).toMatchObject({ claimed: 0 })
    expect(sent).toHaveLength(1)

    await timePasses(t, 14)
    const retry = await drain()
    expect(retry).toMatchObject({ claimed: 1, sent: 1, deferred: 0 })

    expect(sent, 'the next question, exactly once').toHaveLength(2)
    expect(sent[1]).toContain('1. חתונה')
    const after = await session(t)
    expect(after.answers).toEqual({ services: ['stills'] })
    expect(after.version).toBe(before.version + 1)
    expect(await questionnaireOutbound(t)).toHaveLength(2)
    expect(await inboundCount(t), 'the customer did not have to write again').toBe(inboundBefore)
    expect((await jobs(t))[1]).toMatchObject({ status: 'sent', skipReason: null })

    // And it stays done.
    await drain()
    await drain()
    expect(sent).toHaveLength(2)
  })

  it('never answers a replayed job twice: the answer is saved once and the question sent once', async () => {
    const t = await makeTenant('replay')
    await answerDuringPreTurnHold(t)
    await drain()
    await timePasses(t, 14)

    // Two workers wake for the deferred job at once.
    await Promise.all([drain(), drain()])
    expect(sent).toHaveLength(2)

    // The same job replayed after it succeeded — a reclaimed lease, a redelivery.
    const [, job] = await jobs(t)
    await db('auto_response_jobs').where({ id: job.id }).update({ status: 'pending', notBefore: db.raw('now()') })
    await drain()

    expect(sent, 'no second copy of the question').toHaveLength(2)
    expect(await questionnaireOutbound(t)).toHaveLength(2)
    const s = await session(t)
    expect(s.answers).toEqual({ services: ['stills'] })
    expect(Number(s.lastConsumedSequence)).toBe(Number((await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound' }).max('sequence as m'))[0].m))
  })

  it('lets a rep who actually replies before the retry take the conversation', async () => {
    const t = await makeTenant('takeover')
    await answerDuringPreTurnHold(t)
    await drain()
    expect((await jobs(t))[1].status).toBe('pending')

    // What the CRM's send does: takeover first, then the rep's own message.
    await recordHumanTakeover({ agencyId: t.agencyId, leadId: t.leadId, conversationId: t.conversationId })
    await persistOutboundWhatsapp({
      agencyId: t.agencyId, leadId: t.leadId, businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId,
      customerName: 'פונה חדש', sentByUserId: t.userId, wamid: `wamid.rep.${Math.random()}`, text: 'היי, כאן נציג',
    })

    await timePasses(t, 14)
    await drain()

    expect(sent, 'the questionnaire must not speak over the rep').toHaveLength(1)
    expect((await session(t)).status).toBe('human_took_over')
    expect((await jobs(t))[1].status).not.toBe('pending')
    expect(await db('auto_response_jobs').where({ conversationId: t.conversationId, status: 'pending' })).toHaveLength(0)
  })
})

describe('a rep typing during the customer turn', () => {
  it('still discards the turn (human_typing_this_turn) and never retries against the typing rep', async () => {
    const t = await makeTenant('this-turn')
    await customerSays(t, 'שלום')
    await drain()
    await customerSays(t, '1')
    await repTypes(t) // after the answer arrived: this turn is the rep's

    const r = await drain()
    expect(r).toMatchObject({ claimed: 1, sent: 0, skipped: 1, deferred: 0 })
    const [, job] = await jobs(t)
    expect(job).toMatchObject({ status: 'skipped', skipReason: 'human_typing_this_turn' })

    await timePasses(t, 14)
    await drain()
    expect(sent, 'no question once the rep started typing in this turn').toHaveLength(1)
    expect(await db('auto_response_jobs').where({ conversationId: t.conversationId, status: 'pending' })).toHaveLength(0)
    expect((await session(t)).answers).toEqual({})
  })
})

describe('typingDeferUntil', () => {
  const now = '2026-09-29T09:51:45.417Z'
  it('wakes one margin after a live hold expires', () => {
    expect(typingDeferUntil({ now, humanTypingUntil: '2026-09-29T09:51:45.473Z' }).toISOString()).toBe('2026-09-29T09:51:46.473Z')
  })
  it('wakes one margin after now when the hold has already lapsed or is unknown', () => {
    expect(typingDeferUntil({ now, humanTypingUntil: '2026-09-29T09:51:40.000Z' }).toISOString()).toBe('2026-09-29T09:51:46.417Z')
    expect(typingDeferUntil({ now, humanTypingUntil: null }).toISOString()).toBe('2026-09-29T09:51:46.417Z')
  })
})
