import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { claimAutoResponseJobs, enqueueAutoResponse } from '@/db/autoResponseJobs'
import { claimQuestionnaireJobs } from '@/db/questionnaireJobs'
import { enqueueInboundAutoResponse } from '@/lib/inbox/autoresponse/enqueueInboundAutoResponse'

/**
 * THE ROUTING GUARANTEE, AGAINST A REAL DATABASE.
 *
 * "A questionnaire turn never reaches a model" rests entirely on one property:
 * the AI worker's claim cannot see a questionnaire job, and the questionnaire
 * worker's claim cannot see the agent's. Everything else in the feature is
 * downstream of that, so it is tested here directly, in SQL, including in the
 * three moments that are easiest to get wrong — a business being switched over,
 * being switched back, and a rollback that leaves a live session behind.
 *
 * Fixtures are created per test run with their own agencies. No agency id from
 * production appears anywhere.
 */

type Fixture = { agencyId: number; conversationId: number; leadId: number }

const created: number[] = []

async function makeAgency(responder: 'agent' | 'questionnaire', suffix: string): Promise<Fixture> {
  const [a] = await db('agencies').insert({ name: `q-routing-${suffix}`, autoResponseEnabled: true }).returning('id')
  const agencyId = Number(a.id)
  created.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'R', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: 'qualify',
    responder,
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({
      firstName: 'ל',
      lastName: 'א',
      phone: `97250${String(agencyId).padStart(7, '0')}`,
      agencyId,
      userId,
      createdById: userId,
      status: 'new',
    })
    .returning('id')
  const leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: `q_routing_${suffix}`,
      customerWaId: `97250${String(agencyId).padStart(7, '0')}`,
    })
    .returning('id')
  return { agencyId, conversationId: Number(conv.id), leadId }
}

async function enqueue(f: Fixture, reason: 'qualify_turn' | 'questionnaire_turn' | 'first_contact'): Promise<number | null> {
  return db.transaction((trx) =>
    enqueueAutoResponse(trx, {
      agencyId: f.agencyId,
      conversationId: f.conversationId,
      leadId: f.leadId,
      channel: 'whatsapp',
      triggerSequence: 1,
      reason,
    }),
  )
}

/** Claim everything both workers can see, and report which one got what. */
async function claimBoth(): Promise<{ agent: number[]; questionnaire: number[] }> {
  const agent = (await claimAutoResponseJobs('test-agent', 50)).map((j) => j.id)
  const questionnaire = (await claimQuestionnaireJobs('test-questionnaire', 50)).map((j) => j.id)
  return { agent, questionnaire }
}

/** Nothing pending from earlier tests may leak into a claim assertion. */
async function drainPending(): Promise<void> {
  await db('auto_response_jobs').whereIn('status', ['pending', 'processing']).update({ status: 'skipped' })
}

let agentAgency: Fixture
let questionnaireAgency: Fixture

beforeAll(async () => {
  agentAgency = await makeAgency('agent', 'agent')
  questionnaireAgency = await makeAgency('questionnaire', 'quest')
})

afterAll(async () => {
  await db('questionnaire_sessions').whereIn('agencyId', created).del()
  await db('auto_response_jobs').whereIn('agencyId', created).del()
  await db('inbox_messages').whereIn('agencyId', created).del()
  await db('inbox_conversations').whereIn('agencyId', created).del()
  await db('auto_response_settings').whereIn('agencyId', created).del()
  await db('clients').whereIn('agencyId', created).del()
  await db('users').whereIn('agencyId', created).del()
  await db('agencies').whereIn('id', created).del()
})

describe('the two claims partition the queue', () => {
  it('sends an agent business to the AI worker and a questionnaire business to the questionnaire worker', async () => {
    await drainPending()
    const agentJob = await enqueue(agentAgency, 'qualify_turn')
    const questionnaireJob = await enqueue(questionnaireAgency, 'questionnaire_turn')

    const { agent, questionnaire } = await claimBoth()
    expect(agent).toContain(agentJob)
    expect(agent).not.toContain(questionnaireJob)
    expect(questionnaire).toContain(questionnaireJob)
    expect(questionnaire).not.toContain(agentJob)
  })

  it('never lets one job be claimed twice, whichever worker asks first', async () => {
    await drainPending()
    const jobId = await enqueue(questionnaireAgency, 'questionnaire_turn')
    const first = await claimQuestionnaireJobs('w1', 50)
    const second = await claimQuestionnaireJobs('w2', 50)
    const third = await claimAutoResponseJobs('w3', 50)
    expect(first.map((j) => j.id)).toContain(jobId)
    expect(second.map((j) => j.id)).not.toContain(jobId)
    expect(third.map((j) => j.id)).not.toContain(jobId)
  })
})

describe('configuration changing under a pending job', () => {
  it('follows the business when it is switched TO the questionnaire after enqueue', async () => {
    await drainPending()
    // Enqueued while it was still an agent business, as an ordinary AI turn.
    const jobId = await enqueue(agentAgency, 'qualify_turn')
    await db('auto_response_settings')
      .where({ agencyId: agentAgency.agencyId, channel: 'whatsapp' })
      .update({ responder: 'questionnaire' })

    const { agent, questionnaire } = await claimBoth()
    expect(agent).not.toContain(jobId)
    expect(questionnaire).toContain(jobId)

    await db('auto_response_settings')
      .where({ agencyId: agentAgency.agencyId, channel: 'whatsapp' })
      .update({ responder: 'agent' })
  })

  it('keeps a job enqueued as questionnaire work away from the AI worker after a switch back', async () => {
    await drainPending()
    const jobId = await enqueue(questionnaireAgency, 'questionnaire_turn')
    await db('auto_response_settings')
      .where({ agencyId: questionnaireAgency.agencyId, channel: 'whatsapp' })
      .update({ responder: 'agent' })

    const { agent, questionnaire } = await claimBoth()
    expect(agent).not.toContain(jobId)
    expect(questionnaire).toContain(jobId)

    await db('auto_response_settings')
      .where({ agencyId: questionnaireAgency.agencyId, channel: 'whatsapp' })
      .update({ responder: 'questionnaire' })
  })

  it('keeps a conversation with a LIVE session away from the AI worker, which is the rollback case', async () => {
    await drainPending()
    // The rollback: responder back to 'agent' while a customer is mid-script.
    await db('questionnaire_sessions').insert({
      agencyId: agentAgency.agencyId,
      conversationId: agentAgency.conversationId,
      leadId: agentAgency.leadId,
      channel: 'whatsapp',
      status: 'active',
      definition: JSON.stringify({ schemaVersion: 1 }),
      definitionRevision: 1,
    })

    const jobId = await enqueue(agentAgency, 'qualify_turn')
    const { agent, questionnaire } = await claimBoth()
    expect(agent, 'a half-finished questionnaire must not be picked up by the AI').not.toContain(jobId)
    expect(questionnaire).toContain(jobId)

    await db('questionnaire_sessions').where({ conversationId: agentAgency.conversationId }).del()
  })

  it('releases the conversation back to the AI worker once the session has ended', async () => {
    await drainPending()
    await db('questionnaire_sessions').insert({
      agencyId: agentAgency.agencyId,
      conversationId: agentAgency.conversationId,
      leadId: agentAgency.leadId,
      channel: 'whatsapp',
      status: 'handed_off',
      endedReason: 'human_request',
      definition: JSON.stringify({ schemaVersion: 1 }),
      definitionRevision: 1,
    })

    const jobId = await enqueue(agentAgency, 'qualify_turn')
    const { agent, questionnaire } = await claimBoth()
    expect(agent).toContain(jobId)
    expect(questionnaire).not.toContain(jobId)

    await db('questionnaire_sessions').where({ conversationId: agentAgency.conversationId }).del()
  })
})

describe('what the ingest path enqueues', () => {
  it('labels a questionnaire business’s turn as questionnaire work', async () => {
    await drainPending()
    const result = await db.transaction((trx) =>
      enqueueInboundAutoResponse(trx, {
        agencyId: questionnaireAgency.agencyId,
        conversationId: questionnaireAgency.conversationId,
        leadId: questionnaireAgency.leadId,
        triggerSequence: 2,
      }),
    )
    expect(result.reason).toBe('questionnaire_turn')
    const job = await db('auto_response_jobs').where({ id: result.jobId }).first('reason')
    expect(job?.reason).toBe('questionnaire_turn')
  })

  it('leaves an agent business exactly as it was', async () => {
    await drainPending()
    const result = await db.transaction((trx) =>
      enqueueInboundAutoResponse(trx, {
        agencyId: agentAgency.agencyId,
        conversationId: agentAgency.conversationId,
        leadId: agentAgency.leadId,
        triggerSequence: 3,
      }),
    )
    expect(result.reason).toBe('qualify_turn')
  })
})
