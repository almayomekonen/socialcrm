import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'
import { enqueueFollowUpTurnIfOwed } from '@/lib/inbox/autoresponse/followUpTurn'
import { hasPriorOutbound } from '@/db/inboxMessages'

/**
 * V11 — concurrency, against a real PostgreSQL.
 *
 * The brief was explicit: test the concurrency behaviour rather than assuming a
 * periodic sweeper resolves it. The whole defect lives in the interaction
 * between a partial unique index, an `ON CONFLICT DO NOTHING` insert and a
 * worker that read its transcript a moment ago. A mocked query builder cannot
 * reproduce any of that, so this runs on the live test database.
 *
 * The invariant: after every turn settles, no conversation is left with a
 * trailing unanswered inbound and no pending job.
 */

const PHONE_ID = '__followup_pn'
const CUSTOMER = '972500000001'

let agencyId: number
let userId: number
let leadId: number
let conversationId: number

async function addMessage(direction: 'inbound' | 'outbound', text: string): Promise<number> {
  const max = await db('inbox_messages').where({ conversationId }).max<{ max: string | null }>('sequence as max').first()
  const sequence = (Number(max?.max) || 0) + 1
  await db('inbox_messages').insert({
    conversationId,
    agencyId,
    leadId,
    channel: 'whatsapp',
    direction,
    externalId: `__fu_${direction}_${sequence}_${Date.now()}`,
    fromId: direction === 'inbound' ? CUSTOMER : PHONE_ID,
    toId: direction === 'inbound' ? PHONE_ID : CUSTOMER,
    type: 'text',
    text,
    payload: JSON.stringify({}),
    rawPayload: JSON.stringify({}),
    status: direction === 'inbound' ? 'received' : 'sent',
    sentByUserId: null,
    sequence,
    metadata: JSON.stringify(direction === 'outbound' ? { source: 'auto_response' } : {}),
  })
  return sequence
}

const jobCtx = (triggerSequence: number, reason: 'qualify_turn' | 'first_contact' = 'qualify_turn') => ({
  agencyId,
  conversationId,
  leadId,
  channel: 'whatsapp',
  reason,
  triggerSequence,
})

const pendingJobs = () =>
  db('auto_response_jobs').where({ conversationId }).whereIn('status', ['pending', 'processing']).select('id', 'reason', 'triggerSequence')

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_followup__', autoResponseEnabled: true }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'לקוח', lastName: 'בדיקה', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  leadId = Number(c.id)
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    dailyCap: 100,
    quietHours: JSON.stringify({}),
    mode: 'qualify',
    updatedBy: userId,
  })
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: PHONE_ID,
      customerWaId: CUSTOMER,
      customerName: 'לקוח בדיקה',
    })
    .returning('id')
  conversationId = Number(conv.id)
})

beforeEach(async () => {
  await db('auto_response_jobs').where({ conversationId }).del()
  await db('inbox_messages').where({ conversationId }).del()
})

afterAll(async () => {
  await db('auto_response_jobs').where({ conversationId }).del()
  await db('inbox_messages').where({ conversationId }).del()
  await db('inbox_conversations').where({ id: conversationId }).del()
  await db('auto_response_settings').where({ agencyId }).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').where({ id: userId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

describe('the in-flight index really does refuse a second job', () => {
  it('reproduces the drop: an inbound during processing enqueues nothing', async () => {
    await addMessage('inbound', 'הודעה ראשונה')
    const first = await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(1), delaySeconds: 0 }))
    expect(first).not.toBeNull()

    // The worker claims it; the job is now 'processing' and its transcript is read.
    await db('auto_response_jobs').where({ id: first }).update({ status: 'processing' })

    // The customer writes again, mid-generation.
    const second = await addMessage('inbound', 'הודעה שנייה')
    const refused = await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(second), delaySeconds: 0 }))
    expect(refused, 'the index must still collapse rapid messages into one turn').toBeNull()
  })
})

describe('V11 — the follow-up closes the loop', () => {
  it('a message that landed mid-turn gets its own job when the turn settles', async () => {
    await addMessage('inbound', 'הודעה ראשונה')
    const first = await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(1), delaySeconds: 0 }))
    await db('auto_response_jobs').where({ id: first }).update({ status: 'processing' })

    const secondSeq = await addMessage('inbound', 'הודעה שנייה')
    await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(secondSeq), delaySeconds: 0 }))

    // The turn completes, having answered only sequence 1.
    await addMessage('outbound', 'תשובה להודעה הראשונה')
    await db('auto_response_jobs').where({ id: first }).update({ status: 'sent' })

    const { jobId, decision } = await db.transaction((trx) =>
      enqueueFollowUpTurnIfOwed(trx, jobCtx(1), { outcome: 'sent' }),
    )
    expect(decision).toEqual({ enqueue: true, triggerSequence: secondSeq })
    expect(jobId).not.toBeNull()

    const pending = await pendingJobs()
    expect(pending).toHaveLength(1)
    expect(Number(pending[0].triggerSequence)).toBe(secondSeq)
  })

  it('THE INVARIANT — no trailing unanswered inbound is left without a job', async () => {
    await addMessage('inbound', 'הודעה ראשונה')
    const first = await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(1), delaySeconds: 0 }))
    await db('auto_response_jobs').where({ id: first }).update({ status: 'processing' })
    const secondSeq = await addMessage('inbound', 'הודעה שנייה')
    await addMessage('outbound', 'תשובה')
    await db('auto_response_jobs').where({ id: first }).update({ status: 'sent' })
    await db.transaction((trx) => enqueueFollowUpTurnIfOwed(trx, jobCtx(1), { outcome: 'sent' }))

    // The invariant is stated over the newest INBOUND, not the newest message:
    // our own reply sits at a higher sequence than the message that was dropped.
    const newestInbound = await db('inbox_messages')
      .where({ conversationId, direction: 'inbound' })
      .orderBy('sequence', 'desc')
      .first('sequence')
    const open = await pendingJobs()
    const covered = open.some((j) => Number(j.triggerSequence) >= Number(newestInbound?.sequence))
    expect(covered, 'a customer message was left with no job that covers it').toBe(true)
    expect(Number(open[0]?.triggerSequence)).toBe(secondSeq)
  })

  it('does not enqueue when the turn already covered the newest message', async () => {
    await addMessage('inbound', 'הודעה יחידה')
    await addMessage('outbound', 'תשובה')
    const { jobId, decision } = await db.transaction((trx) =>
      enqueueFollowUpTurnIfOwed(trx, jobCtx(1), { outcome: 'sent' }),
    )
    expect(jobId).toBeNull()
    expect(decision).toEqual({ enqueue: false, reason: 'already_covered' })
    expect(await pendingJobs()).toHaveLength(0)
  })

  it('TERMINATES — draining the follow-up leaves nothing more owed', async () => {
    await addMessage('inbound', 'א')
    const first = await db.transaction((trx) => enqueueAutoResponse(trx, { ...jobCtx(1), delaySeconds: 0 }))
    await db('auto_response_jobs').where({ id: first }).update({ status: 'processing' })
    const secondSeq = await addMessage('inbound', 'ב')
    await addMessage('outbound', 'תשובה א')
    await db('auto_response_jobs').where({ id: first }).update({ status: 'sent' })

    const { jobId } = await db.transaction((trx) => enqueueFollowUpTurnIfOwed(trx, jobCtx(1), { outcome: 'sent' }))
    // The follow-up runs and answers sequence 2.
    await addMessage('outbound', 'תשובה ב')
    await db('auto_response_jobs').where({ id: jobId! }).update({ status: 'sent' })

    const again = await db.transaction((trx) =>
      enqueueFollowUpTurnIfOwed(trx, jobCtx(secondSeq), { outcome: 'sent' }),
    )
    expect(again.jobId).toBeNull()
    expect(await pendingJobs()).toHaveLength(0)
  })

  it('a terminal skip never re-opens the conversation', async () => {
    await addMessage('inbound', 'תפסיקו לשלוח לי הודעות')
    const { jobId, decision } = await db.transaction((trx) =>
      enqueueFollowUpTurnIfOwed(trx, jobCtx(1), { outcome: 'skipped', skipReason: 'opt_out' }),
    )
    expect(jobId).toBeNull()
    expect(decision).toEqual({ enqueue: false, reason: 'terminal_opt_out' })
    expect(await pendingJobs()).toHaveLength(0)
  })

  it("acknowledge mode's one-shot promise survives — a sent first_contact blocks the follow-up", async () => {
    await addMessage('inbound', 'הודעה ראשונה')
    const first = await db.transaction((trx) =>
      enqueueAutoResponse(trx, { ...jobCtx(1, 'first_contact'), delaySeconds: 0 }),
    )
    await db('auto_response_jobs').where({ id: first }).update({ status: 'sent' })
    await addMessage('outbound', 'אישור קבלה')
    await addMessage('inbound', 'הודעה שנייה')

    const { jobId } = await db.transaction((trx) =>
      enqueueFollowUpTurnIfOwed(trx, jobCtx(1, 'first_contact'), { outcome: 'sent' }),
    )
    // The decision says a follow-up is owed; the single-job guard then refuses it.
    expect(jobId).toBeNull()
    expect(await pendingJobs()).toHaveLength(0)
  })
})

describe('hasPriorOutbound reads durable state', () => {
  it('is false on a fresh conversation and true once anything was sent', async () => {
    await addMessage('inbound', 'שלום')
    expect(await hasPriorOutbound(conversationId)).toBe(false)
    await addMessage('outbound', 'היי, ברוך הבא 👋')
    expect(await hasPriorOutbound(conversationId)).toBe(true)
  })

  it('stays true past the transcript window — the greeting cannot fire twice', async () => {
    await addMessage('outbound', 'היי, ברוך הבא 👋')
    for (let i = 0; i < 90; i++) await addMessage('inbound', `הודעה ${i}`)
    // 90 later messages push the greeting out of any capped transcript read.
    expect(await hasPriorOutbound(conversationId)).toBe(true)
  })
})
