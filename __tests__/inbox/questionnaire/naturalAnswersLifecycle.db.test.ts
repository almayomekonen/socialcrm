import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { noteKey } from '@/lib/inbox/autoresponse/questionnaire/answerKeys'
import { SYSTEM_LINES } from '@/lib/inbox/autoresponse/questionnaire/render'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'
import { LONG_1200, LONG_15, NATURAL_DEFINITION_RAW } from './fixtures/naturalDefinition'

/**
 * Spec §8.1 (docs/superpowers/specs/2026-10-13-questionnaire-natural-answers-
 * design.md): a long answer survives the whole lifecycle. It is kept on its
 * question, never overwritten, capped in the summary, intact in the inbox,
 * carried through a handoff, and never fatal.
 *
 * Real ingest, queue, claim, decision, persistence and summary; only WhatsApp
 * is faked. Setup follows worker.db.test.ts.
 */

let sent: string[] = []
const send = (async (args: { to: string; body: string }): Promise<SendWhatsappTextResult> => {
  sent.push(args.body)
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never

const agencies: number[] = []

type Tenant = {
  agencyId: number
  userId: number
  leadId: number
  conversationId: number
  phoneNumberId: string
  customerWaId: string
}

async function makeTenant(suffix: string): Promise<Tenant> {
  // plan 'pro': the notification engine gates on product access at delivery.
  const [a] = await db('agencies')
    .insert({ name: `q-natural-${suffix}`, autoResponseEnabled: true, plan: 'pro' })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_natural_pn_${suffix}`
  const customerWaId = `97253${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({
    user_id: userId,
    agency_id: agencyId,
    phone_number_id: phoneNumberId,
    access_token: 'test-token',
  })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: 'acknowledge',
    responder: 'questionnaire',
    questionnaire: JSON.stringify(NATURAL_DEFINITION_RAW),
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({
      firstName: 'פונה',
      lastName: 'חדש',
      phone: customerWaId,
      agencyId,
      userId,
      handlerId: userId,
      createdById: userId,
      status: 'new',
    })
    .returning('id')
  const leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, userId, leadId, conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message, then one drain. */
async function says(t: Tenant, body: string): Promise<void> {
  await ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: {
      id: `wamid.in.${Math.random().toString(36).slice(2)}`,
      from: t.customerWaId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body },
    },
  })
  const result = await runQuestionnaireWorker({ deps: { send }, workerId: `test-${Math.random()}` })
  expect(result.failed, `turn for "${body.slice(0, 20)}" must not fail`).toBe(0)
}

const last = () => sent[sent.length - 1] ?? ''
const sessionOf = (t: Tenant) =>
  db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()
async function answersOf(t: Tenant): Promise<Record<string, string[]>> {
  const s = await sessionOf(t)
  return typeof s.answers === 'string' ? JSON.parse(s.answers) : s.answers
}
async function taskNote(t: Tenant): Promise<string> {
  const task = await db('tasks').where({ clientId: t.leadId }).orderBy('id', 'desc').first('notes')
  const notes = typeof task?.notes === 'string' ? JSON.parse(task.notes) : (task?.notes ?? [])
  return (notes as Array<{ content: string }>).map((n) => n.content).join('\n')
}
async function toIndustry(t: Tenant) {
  await says(t, 'שלום')
  await says(t, '1')
  expect(last()).toContain('באיזה תחום העסק?')
}
/** From the team question to the end: team, process, challenge, source, timing, contact. */
async function finishFromTeam(t: Tenant) {
  for (const reply of ['1', '1', '1', '1', '1', 'טלפונית ב14']) await says(t, reply)
  expect((await sessionOf(t)).status).toBe('completed')
}

const LONG_2 = 'בנוסף אני מצלם אירועי חברה וכנסים קטנים בעיקר בימי חמישי ושישי'

beforeAll(() => {
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
  process.env.WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS = 'all'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})

beforeEach(() => {
  sent = []
})

afterAll(async () => {
  for (const k of [
    'WA_QUESTIONNAIRE_ENABLED',
    'WA_QUESTIONNAIRE_AGENCY_IDS',
    'WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS',
    'NOTIFICATIONS_ENABLED',
    'NOTIFICATIONS_AGENCY_ALLOWLIST',
  ]) {
    delete process.env[k]
  }
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

describe('long-answer lifecycle', () => {
  it('L1 + L2: kept on the right question, and a later selection does not move or overwrite it', async () => {
    const t = await makeTenant('l1')
    await toIndustry(t)
    await says(t, LONG_15)
    let a = await answersOf(t)
    expect(a[noteKey('industry')]).toEqual([LONG_15])
    expect(Object.keys(a).filter((k) => k.endsWith(':note'))).toEqual([noteKey('industry')])
    expect(a[':unplaced']).toBeUndefined()
    expect((await sessionOf(t)).currentStepId).toBe('industry')
    expect(last().startsWith(SYSTEM_LINES.noted)).toBe(true)

    await says(t, '4') // אחר by number: its follow-up is asked; the note is untouched
    a = await answersOf(t)
    expect(a.industry).toEqual(['other'])
    expect(a[noteKey('industry')]).toEqual([LONG_15])
    expect(last()).toContain('באיזה תחום בדיוק?')

    await says(t, 'צילום')
    a = await answersOf(t)
    expect(a[noteKey('industry')]).toEqual([LONG_15])
    expect(a[noteKey('team')]).toBeUndefined()
    await finishFromTeam(t)
    expect(await taskNote(t)).toContain(`תחום: אחר (${LONG_15})`)
  })

  it('L2: a selection by name keeps the note too', async () => {
    const t = await makeTenant('l2b')
    await toIndustry(t)
    await says(t, LONG_15)
    await says(t, 'נדלן')
    const a = await answersOf(t)
    expect(a.industry).toEqual(['realestate'])
    expect(a[noteKey('industry')]).toEqual([LONG_15])
  })

  it('L3: several long replies accumulate in order', async () => {
    const t = await makeTenant('l3')
    await toIndustry(t)
    await says(t, LONG_15)
    await says(t, LONG_2)
    await says(t, '1')
    const a = await answersOf(t)
    expect(a[noteKey('industry')]).toEqual([LONG_15, LONG_2])
    expect(a.industry).toEqual(['services'])
  })

  it('L4: 1,200 characters, capped note, intact inbox row, truncated summary', async () => {
    const t = await makeTenant('l4')
    await toIndustry(t)
    await says(t, LONG_1200)
    const note = (await answersOf(t))[noteKey('industry')].join('')
    expect(note.length).toBeLessThanOrEqual(1000)
    expect(note.endsWith('…')).toBe(true)
    const row = await db('inbox_messages')
      .where({ conversationId: t.conversationId, direction: 'inbound', text: LONG_1200 })
      .first('text')
    expect(row?.text).toHaveLength(1200)

    await says(t, '1')
    await finishFromTeam(t)
    const summary = await taskNote(t)
    expect(summary).toContain('תחום: שירותים וייעוץ (')
    expect(summary).toContain(note)
    expect(summary).not.toContain(LONG_1200)
    const stillThere = await db('inbox_messages')
      .where({ conversationId: t.conversationId, direction: 'inbound', text: LONG_1200 })
      .first('text')
    expect(stillThere?.text).toHaveLength(1200)
  })

  it('L5: handoff after repeated attempts keeps the answer and its question', async () => {
    const t = await makeTenant('l5')
    await toIndustry(t)
    for (const reply of [LONG_15, '?', 'שלום', LONG_2]) await says(t, reply)
    const s = await sessionOf(t)
    expect(s.status).toBe('handed_off')
    expect(s.endedReason).toBe('invalid_limit')
    const summary = await taskNote(t)
    expect(summary).toContain('(לא הושלם)')
    expect(summary).toContain(`תחום: לא נבחרה אפשרות (${LONG_15}; ${LONG_2})`)
    expect(summary).toContain('צורך: ניהול פניות ולידים')
    const notified = await db('notification_jobs').where({ agencyId: t.agencyId, type: 'lead.questionnaire_handoff' })
    expect(notified).toHaveLength(1)
  })

  it('L6: a handoff by command keeps the words under their question', async () => {
    const t = await makeTenant('l6')
    await toIndustry(t)
    for (const reply of ['1', '1', '1', '1', '1', '1']) await says(t, reply) // industry … timing
    expect((await sessionOf(t)).currentStepId).toBe('contact')
    const words = 'אני צריך שמישהו יסביר לי איך זה עובד עם הצוות שלי, נציג בבקשה'
    await says(t, words)
    expect((await sessionOf(t)).status).toBe('handed_off')
    expect(await taskNote(t)).toContain(`חזרה: ללא תשובה (${words})`)
  })

  it('L7: 1,200 characters never fails a turn, at every kind of question', async () => {
    const t = await makeTenant('l7')
    await toIndustry(t)
    await says(t, '1') // industry → team
    await says(t, LONG_1200) // team: single, no אחר
    expect((await answersOf(t))[noteKey('team')].join('').length).toBeLessThanOrEqual(1000)
    for (const reply of ['1', '1', '1']) await says(t, reply) // team, process, challenge
    await says(t, LONG_1200) // source: multi, no אחר
    expect((await answersOf(t))[noteKey('source')].join('').length).toBeLessThanOrEqual(1000)
    for (const reply of ['1', '1']) await says(t, reply) // source, timing
    await says(t, LONG_1200) // contact: free text
    const a = await answersOf(t)
    expect(a.contact[0]).toHaveLength(300)
    expect(a[noteKey('contact')][0].startsWith('…')).toBe(true)
    expect((await sessionOf(t)).status).toBe('completed')
    const rows = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound', text: LONG_1200 })
    expect(rows).toHaveLength(3)
  })

  it('L8: flag off, the same inputs behave exactly as today', async () => {
    process.env.WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS = ''
    try {
      const t = await makeTenant('l8')
      await toIndustry(t)
      await says(t, LONG_15)
      let a = await answersOf(t)
      expect(Object.keys(a).some((k) => k.endsWith(':note'))).toBe(false)
      expect(a[':unplaced']).toEqual([LONG_15])
      expect(last().startsWith(SYSTEM_LINES.invalidChoice)).toBe(true)
      await says(t, '1')
      await says(t, '1') // team
      for (const reply of ['1', '1', '1', '1']) await says(t, reply) // process, challenge, source, timing
      await says(t, LONG_1200) // contact: today's 300-character cap, nothing in a note
      a = await answersOf(t)
      expect(a.contact[0]).toHaveLength(300)
      expect(Object.keys(a).some((k) => k.endsWith(':note'))).toBe(false)
    } finally {
      process.env.WA_QUESTIONNAIRE_NATURAL_AGENCY_IDS = 'all'
    }
  })
})
