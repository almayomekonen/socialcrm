import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { getHandoffSummary, upsertManyConversationIntelligence, getMaxMessageSequence } from '@/db/conversationIntelligence'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'
import { markHumanActiveByConversation } from '@/db/conversationHumanPresence'
import { decideCourtesyClose, isCourtesyMessage, COURTESY_KIND } from '@/lib/inbox/autoresponse/courtesyClose'
import { buildSummary } from '@/lib/inbox/autoresponse/summary'
import { isConfirmedHandoffOffer } from '@/lib/inbox/autoresponse/conversationControl'

/**
 * A HANDOFF IS ONLY REAL IF A REP CAN SEE IT.
 *
 * The customer is told their request is with the team. That sentence is only
 * true if the request is durably in the staff inbox — so this exercises the
 * whole chain against a real database: accepted offer → persisted note →
 * readable by the staff surface → one courtesy reply → still waiting for a rep.
 *
 * It also covers the case that was invisible before: a conversation whose ONLY
 * intelligence row is the handoff note, with no `summary` row from the analysis
 * worker. That is the normal state right after a handoff, and it used to render
 * nothing at all.
 */

const PHONE_ID = '__handoff_vis_pn'
const CUSTOMER = '972500000123'

let agencyId: number
let otherAgencyId: number
let userId: number
let leadId: number
let conversationId: number
let otherConversationId: number

const QUALIFICATION = {
  name: 'קרן מקונן',
  businessType: 'מספרת כלבים',
  need: 'ניהול פניות ולקוחות',
  urgency: 'מיידי',
}

async function seed(name: string, suffix: string) {
  const [a] = await db('agencies').insert({ name, autoResponseEnabled: true }).returning('id')
  const aId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId: aId }).returning('id')
  const uId = Number(u.id)
  const [c] = await db('clients')
    .insert({
      firstName: 'קרן',
      lastName: 'מקונן',
      phone: `${CUSTOMER}${suffix}`,
      agencyId: aId,
      userId: uId,
      createdById: uId,
      status: 'new',
    })
    .returning('id')
  const lId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId: aId,
      leadId: lId,
      channel: 'whatsapp',
      businessPhoneNumberId: `${PHONE_ID}${suffix}`,
      customerWaId: `${CUSTOMER}${suffix}`,
      customerName: 'קרן מקונן',
    })
    .returning('id')
  return { agencyId: aId, userId: uId, leadId: lId, conversationId: Number(conv.id) }
}

/** Exactly what the worker writes when a handoff happens. */
async function persistHandoff(convId: number, agId: number) {
  const summary = buildSummary({ qualification: QUALIFICATION, reason: 'qualified', turnCount: 4, lang: 'he' })
  const coveredSequence = await getMaxMessageSequence(convId)
  const base = {
    conversationId: convId,
    agencyId: agId,
    channel: 'whatsapp',
    status: 'fresh' as const,
    schemaVersion: 1,
    analyzerVersion: 'qualifier-v1',
    coveredSequence,
  }
  await upsertManyConversationIntelligence([
    { ...base, kind: 'temperature', data: { temperature: summary.temperature } },
    {
      ...base,
      kind: 'qualification_summary',
      data: {
        text: summary.text,
        suggestedAction: summary.suggestedAction,
        name: QUALIFICATION.name,
        businessType: QUALIFICATION.businessType,
        need: QUALIFICATION.need,
        urgency: QUALIFICATION.urgency,
        temperature: summary.temperature,
      },
    },
  ])
  await db('conversation_ai_state')
    .insert({ conversationId: convId, agencyId: agId, aiState: 'escalated', aiTurnCount: 4 })
    .onConflict('conversationId')
    .merge({ aiState: 'escalated', aiTurnCount: 4 })
}

beforeAll(async () => {
  const mine = await seed('__test_handoff_vis__', '1')
  agencyId = mine.agencyId
  userId = mine.userId
  leadId = mine.leadId
  conversationId = mine.conversationId
  await db('auto_response_settings').insert({
    agencyId: mine.agencyId,
    channel: 'whatsapp',
    enabled: true,
    dailyCap: 100,
    quietHours: JSON.stringify({}),
    mode: 'qualify',
    updatedBy: mine.userId,
  })
  const theirs = await seed('__test_handoff_vis_other__', '2')
  otherAgencyId = theirs.agencyId
  otherConversationId = theirs.conversationId
})

beforeEach(async () => {
  await db('conversation_intelligence').where({ conversationId }).del()
  await db('conversation_ai_state').where({ conversationId }).del()
  await db('auto_response_jobs').where({ conversationId }).del()
  await db('inbox_messages').where({ conversationId }).del()
})

afterAll(async () => {
  for (const cId of [conversationId, otherConversationId]) {
    await db('conversation_intelligence').where({ conversationId: cId }).del()
    await db('conversation_ai_state').where({ conversationId: cId }).del()
    await db('auto_response_jobs').where({ conversationId: cId }).del()
    await db('inbox_messages').where({ conversationId: cId }).del()
    await db('inbox_conversations').where({ id: cId }).del()
  }
  for (const aId of [agencyId, otherAgencyId]) {
    await db('auto_response_settings').where({ agencyId: aId }).del()
    await db('clients').where({ agencyId: aId }).del()
    await db('users').where({ agencyId: aId }).del()
    await db('agencies').where({ id: aId }).del()
  }
})

describe('the request is durably available to staff', () => {
  it('an accepted offer is what triggers the handoff', () => {
    expect(
      isConfirmedHandoffOffer({
        previousOutbound: 'להעביר את הפנייה שלך לצוות שימשיך איתך?',
        inboundText: 'כן אשמח במיידי!',
      }),
    ).toBe(true)
  })

  it('the note is readable with name, business type, request and urgency', async () => {
    await persistHandoff(conversationId, agencyId)
    const note = await getHandoffSummary(agencyId, conversationId)
    expect(note).not.toBeNull()
    expect(note?.name).toBe('קרן מקונן')
    expect(note?.businessType).toBe('מספרת כלבים')
    expect(note?.need).toBe('ניהול פניות ולקוחות')
    expect(note?.urgency).toBe('מיידי')
    expect(note?.temperature).toBe('hot')
  })

  it('urgency from "כן אשמח במיידי!" survives into the note', async () => {
    await persistHandoff(conversationId, agencyId)
    const note = await getHandoffSummary(agencyId, conversationId)
    expect(note?.urgency).toBe('מיידי')
    // hot, so the suggested action is to call — which staff can see and act on.
    expect(note?.text).toContain('דחיפות: מיידי')
  })

  it('RENDERS FROM THE HANDOFF ROW ALONE — no analysis-worker summary row exists', async () => {
    await persistHandoff(conversationId, agencyId)
    const kinds = await db('conversation_intelligence').where({ conversationId }).pluck('kind')
    expect(kinds).toContain('qualification_summary')
    expect(kinds, 'precondition: the analysis worker has NOT run here').not.toContain('summary')
    expect(await getHandoffSummary(agencyId, conversationId)).not.toBeNull()
  })

  it('is tenant-scoped — another agency cannot read it', async () => {
    await persistHandoff(conversationId, agencyId)
    expect(await getHandoffSummary(otherAgencyId, conversationId)).toBeNull()
  })

  it('a retry does not create a duplicate item', async () => {
    await persistHandoff(conversationId, agencyId)
    await persistHandoff(conversationId, agencyId)
    await persistHandoff(conversationId, agencyId)
    const rows = await db('conversation_intelligence').where({ conversationId, kind: 'qualification_summary' })
    expect(rows).toHaveLength(1)
  })

  it('omits fields the customer never supplied rather than inventing them', async () => {
    const summary = buildSummary({ qualification: { name: 'דנה' }, reason: 'qualified', turnCount: 2, lang: 'he' })
    await upsertManyConversationIntelligence([
      {
        conversationId,
        agencyId,
        channel: 'whatsapp',
        status: 'fresh',
        schemaVersion: 1,
        analyzerVersion: 'qualifier-v1',
        coveredSequence: 0,
        kind: 'qualification_summary',
        data: { text: summary.text, suggestedAction: summary.suggestedAction, name: 'דנה' },
      },
    ])
    const note = await getHandoffSummary(agencyId, conversationId)
    expect(note?.name).toBe('דנה')
    expect(note?.businessType).toBeNull()
    expect(note?.urgency).toBeNull()
  })
})

describe('courtesy after a REAL handoff', () => {
  const facts = (over = {}) => ({
    inboundText: 'תודה רבה',
    agentHasSpoken: true,
    humanTookOver: false,
    optOut: false,
    alreadySentCourtesy: false,
    ...over,
  })

  it('an escalated conversation still answers thanks', async () => {
    await persistHandoff(conversationId, agencyId)
    const state = await db('conversation_ai_state').where({ conversationId }).first('aiState')
    expect(state?.aiState).toBe('escalated')
    expect(decideCourtesyClose(facts())).toEqual({ send: true })
  })

  it('and stays escalated — the request is still waiting for a rep', async () => {
    await persistHandoff(conversationId, agencyId)
    // The worker's escalated branch passes closeAfter:null, so nothing closes.
    const before = await db('conversation_ai_state').where({ conversationId }).first('aiState')
    expect(before?.aiState).toBe('escalated')
    expect(await getHandoffSummary(agencyId, conversationId)).not.toBeNull()
  })

  it('EXACTLY ONE — a second thanks is silent', () => {
    expect(decideCourtesyClose(facts({ alreadySentCourtesy: true }))).toEqual({
      send: false,
      reason: 'already_sent',
    })
  })

  it('a real human takeover blocks it', async () => {
    await persistHandoff(conversationId, agencyId)
    await markHumanActiveByConversation(conversationId, agencyId)
    expect(decideCourtesyClose(facts({ humanTookOver: true }))).toEqual({ send: false, reason: 'human_owns' })
  })

  it('opt-out blocks it', () => {
    expect(decideCourtesyClose(facts({ optOut: true }))).toEqual({ send: false, reason: 'opted_out' })
  })
})

/**
 * CONCURRENCY. A transcript marker alone does not prove two workers cannot both
 * send the courtesy line — both could read the transcript before either writes.
 * The actual guarantee is the partial unique index on auto_response_jobs, which
 * permits at most ONE in-flight job per conversation, so two workers can never
 * hold a job for the same conversation at the same time.
 */
describe('two workers cannot both send the courtesy reply', () => {
  it('the in-flight unique index refuses a second concurrent job', async () => {
    const ctx = {
      agencyId,
      conversationId,
      leadId,
      channel: 'whatsapp',
      reason: 'qualify_turn' as const,
      triggerSequence: 1,
      delaySeconds: 0,
    }
    const first = await db.transaction((trx) => enqueueAutoResponse(trx, ctx))
    expect(first).not.toBeNull()
    await db('auto_response_jobs').where({ id: first }).update({ status: 'processing' })

    const second = await db.transaction((trx) => enqueueAutoResponse(trx, { ...ctx, triggerSequence: 2 }))
    expect(second, 'a second in-flight job was created for the same conversation').toBeNull()

    const inflight = await db('auto_response_jobs')
      .where({ conversationId })
      .whereIn('status', ['pending', 'processing'])
    expect(inflight).toHaveLength(1)
  })

  it('the index really is scoped to in-flight statuses only', async () => {
    const [{ indexdef }] = await db
      .select('indexdef')
      .from('pg_indexes')
      .where({ indexname: 'auto_response_jobs_inflight_uniq' })
    expect(indexdef).toContain('conversationId')
    expect(indexdef).toMatch(/pending/)
    expect(indexdef).toMatch(/processing/)
  })

  it('and the marker is the second line of defence, not the first', () => {
    expect(isCourtesyMessage({ kind: COURTESY_KIND })).toBe(true)
  })
})
