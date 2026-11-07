/**
 * T12, draft expiry: an expired `proposed` draft becomes discarded/expired, its
 * text is cleared, its pending token is expired in the same transaction, and an
 * audit event (without text) is written. Real Postgres.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { expireReminderDrafts } from '@/db/ownerPersonalReminders/expireDrafts'
import { insertApproval, insertDraft, seedOwner } from './fixtures'

afterAll(async () => {
  await db.destroy()
})

const PAST = () => new Date(Date.now() - 60_000)
const draft = (id: number) =>
  db('owner_personal_reminders').where({ id }).first('status', 'discardReason', 'text', 'textLength', 'finalizedAt')
const token = (t: string) => db('wa_assistant_approvals').where({ token: t }).first('status')

describe('expireReminderDrafts', () => {
  it('discards the expired draft, clears its text, expires its token and records an event', async () => {
    const o = await seedOwner('t12')
    const id = await insertDraft(o, { draftExpiresAt: PAST(), proposalActionId: 'rem_t12_v1_create' })
    const t = await insertApproval(o, 'rem_t12_v1_create')
    expect(await expireReminderDrafts(new Date())).toBeGreaterThanOrEqual(1)
    expect(await draft(id)).toMatchObject({ status: 'discarded', discardReason: 'expired', text: null, textLength: 11 })
    expect((await draft(id))?.finalizedAt).not.toBeNull()
    expect(await token(t)).toEqual({ status: 'expired' })
    const events = await db('owner_personal_reminder_events').where({ reminderId: id })
    expect(events).toMatchObject([
      { type: 'discarded', actorKind: 'system', fromStatus: 'proposed', toStatus: 'discarded', reason: 'expired', actionId: 'rem_t12_v1_create' },
    ])
  })

  it('leaves a draft that has not expired yet', async () => {
    const o = await seedOwner('t12-live')
    const id = await insertDraft(o)
    await expireReminderDrafts(new Date())
    expect(await draft(id)).toMatchObject({ status: 'proposed', text: 'להתקשר לאבי' })
  })

  it('leaves a draft whose token was approved (the resume path decides it)', async () => {
    const o = await seedOwner('t12-approved')
    const id = await insertDraft(o, { draftExpiresAt: PAST(), proposalActionId: 'rem_t12a_v1_create' })
    await insertApproval(o, 'rem_t12a_v1_create', { status: 'approved' })
    await expireReminderDrafts(new Date())
    expect(await draft(id)).toMatchObject({ status: 'proposed' })
  })

  it('never touches another action\'s pending token, or a task card', async () => {
    const o = await seedOwner('t12-other')
    await insertDraft(o, { draftExpiresAt: PAST(), proposalActionId: 'rem_t12o_v1_create' })
    const taskCard = await insertApproval(o, 'act_task_unrelated')
    await expireReminderDrafts(new Date())
    expect(await token(taskCard)).toEqual({ status: 'pending' })
  })

  it('a draft without a proposal action is still discarded', async () => {
    const o = await seedOwner('t12-noaction')
    const id = await insertDraft(o, { draftExpiresAt: PAST() })
    await expireReminderDrafts(new Date())
    expect(await draft(id)).toMatchObject({ status: 'discarded', discardReason: 'expired' })
  })

  it('skips a draft another transaction holds (SKIP LOCKED), and expires it on the next run', async () => {
    const o = await seedOwner('t12-locked')
    const id = await insertDraft(o, { draftExpiresAt: PAST() })
    const trx = await db.transaction()
    await trx('owner_personal_reminders').where({ id }).forUpdate().first('id')
    await expireReminderDrafts(new Date())
    expect(await draft(id)).toMatchObject({ status: 'proposed' })
    await trx.commit()
    await expireReminderDrafts(new Date())
    expect(await draft(id)).toMatchObject({ status: 'discarded' })
  })

  it('a second run changes nothing and writes no second event', async () => {
    const o = await seedOwner('t12-idem')
    const id = await insertDraft(o, { draftExpiresAt: PAST() })
    await expireReminderDrafts(new Date())
    await expireReminderDrafts(new Date())
    expect(await db('owner_personal_reminder_events').where({ reminderId: id })).toHaveLength(1)
  })
})
