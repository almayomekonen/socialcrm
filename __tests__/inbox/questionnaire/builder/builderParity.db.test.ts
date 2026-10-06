import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { simulateConversation } from '@/lib/inbox/autoresponse/questionnaire/builder/simulate'
import { publishDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/publish'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { markHumanActiveByConversation } from '@/db/conversationHumanPresence'
import { getHandoffSummary } from '@/db/conversationIntelligence'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Simulator parity and session pinning, against the real worker.
 *
 * PARITY. The same conversations run through (A) the production questionnaire
 * path — webhook ingest, job queue, claim, processJob, the send guards, with
 * only the Graph call faked — and (B) the Builder's simulator. Every turn's
 * replies, and the final answers and status, must be identical. The simulator
 * decides nothing itself (builder/simulate.ts); this is the proof.
 *
 * PINNING. A conversation started on revision N finishes on N after N+1 is
 * published through the Builder's publish service; a new conversation starts
 * on N+1.
 *
 * The harness is perfectPicture.db.test.ts's.
 */

const sample = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'))
const DEF = sample('perfect-picture.he.json')
const OLD_DEF = sample('event-photography.he.json')

type Sent = { to: string; body: string }

let sent: Sent[] = []
let sendImpl: (args: { to: string; body: string }) => Promise<SendWhatsappTextResult>

const send = (async (args: { to: string; body: string }) => {
  const result = await sendImpl(args)
  if (result.ok) sent.push({ to: args.to, body: args.body })
  return result
}) as never

const okSend = async (): Promise<SendWhatsappTextResult> => ({
  ok: true,
  wamid: `wamid.out.${Math.random().toString(36).slice(2)}`,
})

const agencies: number[] = []

type Tenant = {
  agencyId: number
  userId: number
  leadId: number
  conversationId: number
  phoneNumberId: string
  customerWaId: string
}

async function makeTenant(suffix: string, definition: unknown = DEF): Promise<Tenant> {
  // plan 'pro' because the notification engine gates on product access at the
  // delivery boundary; a free agency would prove nothing about the emission.
  const [a] = await db('agencies')
    .insert({ name: `q-parity-${suffix}`, autoResponseEnabled: true, plan: 'pro' })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_parity_pn_${suffix}`
  const customerWaId = `97252${String(agencyId).padStart(7, '0')}`
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
    questionnaire: JSON.stringify(definition),
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

/** Exactly what the webhook does with one customer message. */
async function customerSays(t: Tenant, body: string, opts: { type?: string } = {}): Promise<void> {
  const type = opts.type ?? 'text'
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
      type,
      ...(type === 'text' ? { text: { body } } : { [type]: { id: 'media-id' } }),
    },
  })
}

async function drain(): Promise<void> {
  await runQuestionnaireWorker({ deps: { send }, workerId: `test-${Math.random()}` })
}

const lastMessage = (): string => sent[sent.length - 1]?.body ?? ''

async function sessionRow(t: Tenant) {
  return db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()
}

beforeAll(() => {
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})

beforeEach(() => {
  sent = []
  sendImpl = okSend
})

afterAll(async () => {
  delete process.env.WA_QUESTIONNAIRE_ENABLED
  delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
  delete process.env.NOTIFICATIONS_ENABLED
  delete process.env.NOTIFICATIONS_AGENCY_ALLOWLIST
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
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL questionnaire.allow_purge = 'on'`)
    await trx('questionnaire_revisions').whereIn('agencyId', agencies).del()
  })
  await db('agencies').whereIn('id', agencies).del()
})



const PILOT = sample('socialcrm-pilot.he.json')
const SALON = (() => {
  const d = {
    schemaVersion: 1, revision: 1, language: 'he', welcome: 'שלום, נשמח להכיר אותך',
    closing: 'תודה! נחזור אלייך בהקדם 🙏', handoff: 'תודה! העברנו את השיחה לצוות.', summaryTitle: 'שאלון וואטסאפ הושלם',
    maxInvalidAttempts: 2, expireAfterHours: 24,
    steps: [
      { id: 'q_treatment', label: 'טיפול', prompt: 'איזה טיפול מעניין אותך?', type: 'choice', options: [{ id: 'o_makeup', label: 'איפור' }, { id: 'o_hair', label: 'שיער' }, { id: 'o_both', label: 'איפור ושיער' }] },
      { id: 'q_date', label: 'תאריך', prompt: 'לאיזה תאריך?', type: 'text', validate: 'date', allowNotSet: true },
    ],
  }
  const p = parseQuestionnaireDefinition(d)
  if (p.ok === false) throw new Error(p.errors.join())
  return p.definition
})()

/** (A) the production path: each turn is ingested, then the worker runs. */
async function viaWorker(definition: unknown, name: string, turns: string[][]) {
  const t = await makeTenant(name, definition)
  const replies: string[][] = []
  for (const turn of turns) {
    const before = sent.length
    for (const m of turn) await customerSays(t, m)
    for (let i = 0; i < 4; i++) await drain()
    replies.push(sent.slice(before).map((s) => s.body))
  }
  const session = await sessionRow(t)
  return { replies, answers: session?.answers ?? {}, status: session?.status ?? 'not_started' }
}

function viaSimulator(definition: QuestionnaireDefinition, turns: string[][]) {
  const r = simulateConversation(definition, turns)
  return { replies: r.turns.map((x) => x.replies), answers: r.answers, status: r.status }
}

const SCENARIOS: Array<[string, QuestionnaireDefinition, string[][]]> = [
  ['natural alias, wedding to completion', DEF, [['היי'], ['אנחנו מתחתנים'], ['18.11.2026'], ['רחובות'], ['סטילס']]],
  ['invalid date, then a real one', DEF, [['היי'], ['חתונה'], ['לתאריך'], ['18.11.2026'], ['רחובות'], ['סטילס']]],
  ['not set, date and venue', DEF, [['היי'], ['בת מצווה לילדה'], ['לא נקבע'], ['עוד לא סגרנו אולם'], ['הכל']]],
  ['customer questions', DEF, [['היי'], ['כמה זה עולה?'], ['1'], ['אתם פנויים ב-18.11?'], ['אתם מגיעים לחיפה?'], ['חיפה'], ['מה ההבדל בין סטילס לוידאו?'], ['סטילס ווידאו']]],
  ['multi-select with other service', DEF, [['היי'], ['חינה'], ['יוני'], ['נתניה'], ['וידאו ואחר'], ['צילום משפחתי']]],
  ['other event', DEF, [['היי'], ['אירוע אחר'], ['הצעת נישואין'], ['בסוף החודש'], ['הרצליה'], ['1']]],
  ['drone with uncertain permission', DEF, [['היי'], ['צריך רחפן לצילום נכס'], ['כמה מקומות'], ['כן אבל לא בטוח'], ['לא בטוח'], ['20.10.2026']]],
  ['ambiguous choices until a person', DEF, [['היי'], ['חתונה או חינה'], ['צילום רחפן לחתונה'], ['עוד לא החלטנו']]],
  ['correction at a later question', DEF, [['היי'], ['חתונה'], ['18.11'], ['טעיתי, 19.11'], ['רחובות'], ['סטילס']]],
  ['rapid burst', DEF, [['היי'], ['חתונה', '18.11', 'רחובות'], ['18.11'], ['רחובות'], ['הכל']]],
  ['refusing then asking for a person', DEF, [['היי'], ['חתונה'], ['אני לא רוצה נציג'], ['נציג בבקשה']]],
  ['opt-out', DEF, [['היי'], ['חתונה'], ['אל תשלחו לי יותר']]],
  ['salon: choice, then "not decided yet"', SALON, [['היי'], ['שיער'], ['עדיין לא נקבע']]],
  ['agency 103 pilot', PILOT, [['היי'], ['סטודיו לצילום'], ['1'], ['1'], ['כ-50 בחודש'], ['1'], ['Perfect']]],
]

describe('simulator ≡ worker', () => {
  it.each(SCENARIOS)('%s', async (name, definition, turns) => {
    const worker = await viaWorker(definition, name.replace(/\W+/g, '-'), turns)
    const simulator = viaSimulator(definition, turns)
    expect(simulator.replies).toEqual(worker.replies)
    expect(simulator.answers).toEqual(worker.answers)
    expect(simulator.status).toEqual(worker.status)
    expect(worker.replies.flat().length).toBeGreaterThan(0)
  })
})

describe('pinning through the publish service', () => {
  it('a conversation on revision N finishes on N; a new conversation starts on N+1', async () => {
    const t = await makeTenant('pin', DEF)
    // The migration's backfill turns the live definition into revision 4.
    await require(path.join(process.cwd(), 'migrations/20261006120000_questionnaire_revisions.cjs')).up(db)
    await customerSays(t, 'היי')
    await drain()
    await customerSays(t, 'חתונה')
    await drain()
    expect((await sessionRow(t))?.definitionRevision).toBe(4)

    const next = JSON.parse(JSON.stringify(DEF))
    next.welcome = 'שלום! ברוכים הבאים, גרסה חדשה.'
    next.closingVariants[2].text = next.closingVariants[2].text.replace('https://wisepage.wwcrm.co.il/picture-perfect', 'https://example.org/weddings')
    expect(await publishDefinition({ agencyId: t.agencyId, definition: next })).toMatchObject({ ok: true, revision: 5 })

    for (const m of ['18.11', 'רחובות', 'סטילס']) {
      await customerSays(t, m)
      await drain()
    }
    const closing = sent[sent.length - 1].body
    expect(closing).toContain('https://wisepage.wwcrm.co.il/picture-perfect') // revision 4's link
    expect(closing).not.toContain('example.org')
    expect(await sessionRow(t)).toMatchObject({ status: 'completed', definitionRevision: 4 })

    // A new customer of the same business.
    const customerWaId = `97253${String(t.agencyId).padStart(7, '0')}`
    const [lead] = await db('clients').insert({ firstName: 'פונה', lastName: 'שני', phone: customerWaId, agencyId: t.agencyId, userId: t.userId, handlerId: t.userId, createdById: t.userId, status: 'new' }).returning('id')
    const [conv] = await db('inbox_conversations').insert({ agencyId: t.agencyId, leadId: lead.id, channel: 'whatsapp', businessPhoneNumberId: t.phoneNumberId, customerWaId }).returning('id')
    const second = { ...t, leadId: Number(lead.id), conversationId: Number(conv.id), customerWaId }
    await customerSays(second, 'היי')
    await drain()
    expect(sent[sent.length - 1].body).toContain('שלום! ברוכים הבאים, גרסה חדשה.')
    expect((await sessionRow(second))?.definitionRevision).toBe(5)
  })
})
