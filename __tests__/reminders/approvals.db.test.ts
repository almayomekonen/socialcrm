/**
 * Approval tokens (architecture v1.6, v1.6.1): one pending token per recipient on
 * every creation path, one token for life per reminder action, and concurrent
 * creators serialized on the recipient row. Real Postgres, real concurrency:
 * races are ordered by holding the recipient lock in a separate transaction and
 * waiting until the contenders are blocked on it.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  createWaApproval,
  decideWaApproval,
  ensureWaApprovalForAction,
  WaApprovalRecipientMissingError,
} from '@/db/waAssistantApprovals'
import { insertApproval, pgCode, seedOwner, untilLockWaiters, type Owner } from './fixtures'

afterAll(async () => {
  await db.destroy()
})

const T = 'wa_assistant_approvals'
const now = () => new Date()
const input = (o: Owner, actionId: string, at = now()) => ({
  recipientId: o.recipientId,
  agencyId: o.agencyId,
  userId: o.userId,
  jobId: 1,
  actionId,
  argsHash: `h:${actionId}`,
  now: at,
})
const pending = (o: Owner) => db(T).where({ recipientId: o.recipientId, status: 'pending' })

/** Hold the recipient row lock until `release()`, so contenders queue behind it. */
async function holdRecipient(o: Owner) {
  const trx = await db.transaction()
  await trx('owner_whatsapp_recipients').where({ id: o.recipientId }).forUpdate().first('id')
  return { release: () => trx.commit() }
}

describe('ensureWaApprovalForAction: one token per reminder action, for life', () => {
  it('AP-1: an existing pending token is returned, not replaced', async () => {
    const o = await seedOwner('ap1')
    const first = await ensureWaApprovalForAction(input(o, 'rem_1_v1_create'))
    const again = await ensureWaApprovalForAction(input(o, 'rem_1_v1_create'))
    expect(first.kind).toBe('created')
    expect(again).toMatchObject({ kind: 'existing_pending', token: (first as { token: string }).token })
    expect(await db(T).where({ actionId: 'rem_1_v1_create' })).toHaveLength(1)
  })

  it('AP-2: an approved token → already_decided, no new token', async () => {
    const o = await seedOwner('ap2')
    const first = (await ensureWaApprovalForAction(input(o, 'rem_2_v1_create'))) as { token: string }
    await decideWaApproval({ token: first.token, recipientId: o.recipientId, decision: 'approved', now: now() })
    expect(await ensureWaApprovalForAction(input(o, 'rem_2_v1_create'))).toEqual({ kind: 'already_decided', status: 'approved' })
    expect(await db(T).where({ actionId: 'rem_2_v1_create' })).toHaveLength(1)
  })

  it.each([['rejected'], ['superseded'], ['expired']])('AP-3/4/5: a %s token is terminal, never reissued', async (status) => {
    const o = await seedOwner(`ap-${status}`)
    const actionId = `rem_${status}_v1_create`
    await insertApproval(o, actionId, { status, argsHash: `h:${actionId}` })
    expect(await ensureWaApprovalForAction(input(o, actionId))).toEqual({ kind: 'terminal', status })
    expect(await db(T).where({ actionId })).toHaveLength(1)
  })

  it('AP-4: a pending token past its expiry is marked expired and is terminal', async () => {
    const o = await seedOwner('ap4b')
    await insertApproval(o, 'rem_4_v1_create', { argsHash: 'h:rem_4_v1_create', expiresAt: new Date(Date.now() - 1000) })
    expect(await ensureWaApprovalForAction(input(o, 'rem_4_v1_create'))).toEqual({ kind: 'terminal', status: 'expired' })
    expect(await db(T).where({ actionId: 'rem_4_v1_create' }).first('status')).toEqual({ status: 'expired' })
  })

  it('AP-7: a second token row for the same reminder action is impossible (23505)', async () => {
    const o = await seedOwner('ap7')
    await insertApproval(o, 'rem_7_v1_create', { status: 'rejected' })
    expect(await pgCode(insertApproval(o, 'rem_7_v1_create', { status: 'expired' }))).toBe('23505')
  })

  it('only reminder action ids are accepted', async () => {
    const o = await seedOwner('prefix')
    await expect(ensureWaApprovalForAction(input(o, 'act_123'))).rejects.toThrow(/reminder action ids only/)
  })

  it('DL-8: no recipient row → no_recipient, nothing written', async () => {
    const o = await seedOwner('dl8')
    const ghost = { ...o, recipientId: o.recipientId + 1_000_000 }
    expect(await ensureWaApprovalForAction(input(ghost, 'rem_8_v1_create'))).toEqual({ kind: 'no_recipient' })
    await expect(createWaApproval(input(ghost, 'act_dl8'))).rejects.toBeInstanceOf(WaApprovalRecipientMissingError)
    expect(await db(T).where({ recipientId: ghost.recipientId })).toHaveLength(0)
  })
})

describe('one pending token per recipient, on every path', () => {
  it('DL-7: a direct second pending row for one recipient is impossible (23505)', async () => {
    const o = await seedOwner('dl7')
    await insertApproval(o, 'act_a')
    expect(await pgCode(insertApproval(o, 'act_b'))).toBe('23505')
  })

  it('AP-8: tasks and meetings keep their behaviour: each card supersedes the last', async () => {
    const o = await seedOwner('ap8')
    const a = await createWaApproval(input(o, 'act_task_1'))
    const b = await createWaApproval(input(o, 'act_task_1')) // the same legacy id twice is still allowed
    expect(a.token).not.toBe(b.token)
    expect(await pending(o)).toMatchObject([{ token: b.token }])
    expect(await db(T).where({ token: a.token }).first('status')).toEqual({ status: 'superseded' })
  })

  it('a reminder card supersedes a pending task card, and the other way round', async () => {
    const o = await seedOwner('cross')
    const task = await createWaApproval(input(o, 'act_task_x'))
    const rem = (await ensureWaApprovalForAction(input(o, 'rem_x_v1_create'))) as { token: string }
    expect(await db(T).where({ token: task.token }).first('status')).toEqual({ status: 'superseded' })
    const meeting = await createWaApproval(input(o, 'act_meeting_x'))
    expect(await db(T).where({ token: rem.token }).first('status')).toEqual({ status: 'superseded' })
    expect(await pending(o)).toMatchObject([{ token: meeting.token }])
  })
})

describe('concurrency (two or more connections)', () => {
  it('DL-1: two reminder actions for the same recipient, neither with a token → serialized, one pending, no error', async () => {
    const o = await seedOwner('dl1')
    const hold = await holdRecipient(o)
    const p1 = ensureWaApprovalForAction(input(o, 'rem_d1a_v1_create'))
    const p2 = ensureWaApprovalForAction(input(o, 'rem_d1b_v1_create'))
    await untilLockWaiters(2)
    await hold.release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect([r1.kind, r2.kind].sort()).toEqual(['created', 'created'])
    expect(await pending(o)).toHaveLength(1)
    expect(await db(T).where({ recipientId: o.recipientId, status: 'superseded' })).toHaveLength(1)
  })

  it('DL-2: a reminder path and the task path at the same time → serialized, one pending, no error', async () => {
    const o = await seedOwner('dl2')
    const hold = await holdRecipient(o)
    const p1 = ensureWaApprovalForAction(input(o, 'rem_d2_v1_create'))
    const p2 = createWaApproval(input(o, 'act_task_d2'))
    await untilLockWaiters(2)
    await hold.release()
    await Promise.all([p1, p2])
    expect(await pending(o)).toHaveLength(1)
  })

  it('DL-3: the same reminder action twice at once → one row; the second caller gets the same token', async () => {
    const o = await seedOwner('dl3')
    const hold = await holdRecipient(o)
    const p1 = ensureWaApprovalForAction(input(o, 'rem_d3_v1_create'))
    const p2 = ensureWaApprovalForAction(input(o, 'rem_d3_v1_create'))
    await untilLockWaiters(2)
    await hold.release()
    const [r1, r2] = (await Promise.all([p1, p2])) as { kind: string; token: string }[]
    expect([r1.kind, r2.kind].sort()).toEqual(['created', 'existing_pending'])
    expect(r1.token).toBe(r2.token)
    expect(await db(T).where({ actionId: 'rem_d3_v1_create' })).toHaveLength(1)
  })

  it('DL-6: a tap racing a new card, both orders, leaves exactly one pending token and never two approvals', async () => {
    const o = await seedOwner('dl6')
    const old = (await ensureWaApprovalForAction(input(o, 'rem_d6a_v1_create'))) as { token: string }
    // Tap first: approved stays approved, the new card is the one pending token.
    await decideWaApproval({ token: old.token, recipientId: o.recipientId, decision: 'approved', now: now() })
    await ensureWaApprovalForAction(input(o, 'rem_d6b_v1_create'))
    expect(await db(T).where({ token: old.token }).first('status')).toEqual({ status: 'approved' })
    expect(await pending(o)).toHaveLength(1)
    // New card first: the older pending card is superseded and its tap is refused.
    const live = (await pending(o))[0] as { token: string }
    await ensureWaApprovalForAction(input(o, 'rem_d6c_v1_create'))
    expect(await decideWaApproval({ token: live.token, recipientId: o.recipientId, decision: 'approved', now: now() })).toEqual({
      ok: false,
      reason: 'superseded',
    })
  })

  it('no deadlock with a keyword-style opt-out (recipient then reminder rows) racing card creation', async () => {
    const o = await seedOwner('optout-race')
    const hold = await holdRecipient(o)
    const card = ensureWaApprovalForAction(input(o, 'rem_oo_v1_create'))
    const optOut = db.transaction(async (trx) => {
      await trx('owner_whatsapp_recipients').where({ id: o.recipientId }).forUpdate().first('id')
      await trx('owner_whatsapp_recipients').where({ id: o.recipientId }).update({ status: 'opted_out', optedOutAt: trx.fn.now(), optOutSource: 'keyword' })
      await trx('owner_personal_reminders').where({ recipientId: o.recipientId }).whereIn('status', ['proposed', 'scheduled', 'claimed']).select('id').forUpdate()
    })
    await untilLockWaiters(2)
    await hold.release()
    await expect(Promise.all([card, optOut])).resolves.toBeDefined()
  })
})
