/**
 * Reminder Engine Phase 3 schema: constraints, the guard trigger, uniqueness,
 * the audit table's shape and the provenance columns. Real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { insertDraft, pgCode, seedOwner, type Owner } from './fixtures'

const T = 'owner_personal_reminders'
let A: Owner
let B: Owner

beforeAll(async () => {
  A = await seedOwner('schema-a')
  B = await seedOwner('schema-b')
})
afterAll(async () => {
  await db.destroy()
})

const update = (id: number, patch: Record<string, unknown>) => db(T).where({ id }).update(patch)
const HOUR = 3_600_000

describe('lifetime uniqueness', () => {
  it('one inbound wamid → one reminder request, even after the first is discarded', async () => {
    const id = await insertDraft(A, { sourceWamid: 'wamid.life.1' })
    await update(id, { status: 'discarded', discardReason: 'rejected', finalizedAt: new Date(), text: null })
    expect(await pgCode(insertDraft(A, { sourceWamid: 'wamid.life.1' }))).toBe('23505')
  })

  it('the same wamid for another recipient is a different request', async () => {
    await insertDraft(A, { sourceWamid: 'wamid.life.2' })
    expect(await pgCode(insertDraft(B, { sourceWamid: 'wamid.life.2' }))).toBeNull()
  })

  it('at most one live draft per recipient', async () => {
    const o = await seedOwner('one-draft')
    await insertDraft(o)
    expect(await pgCode(insertDraft(o))).toBe('23505')
  })

  it('one createdByActionId per agency, and one wamid', async () => {
    const o = await seedOwner('action-uniq')
    const a = await insertDraft(o, { sourceWamid: 'w-a1' })
    await update(a, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_1_v1_create' })
    const b = await insertDraft(o, { sourceWamid: 'w-a2' })
    expect(await pgCode(update(b, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_1_v1_create' }))).toBe('23505')
  })
})

describe('row constraints', () => {
  it.each([
    ['an unknown status', { status: 'bogus' }],
    ['text with a newline', { text: 'שורה\nשנייה', textLength: 11 }],
    ['textLength not matching the text', { text: 'abc', textLength: 4 }],
    ['a draft with no expiry', { draftExpiresAt: null }],
    ['remindAt not after createdAt', { remindAt: new Date(Date.now() - HOUR) }],
    ['a failure reason outside the list', { status: 'failed', failureReason: 'nope', finalizedAt: new Date() }],
  ])('rejects %s', async (_label, over) => {
    const o = await seedOwner('chk')
    expect(await pgCode(insertDraft(o, over))).toBe('23514')
  })

  it.each([
    ['sent without a wamid', { status: 'sent', sentAt: new Date(), dispatchedAt: new Date(), finalizedAt: new Date() }],
    ['claimed without a claim token', { status: 'claimed', claimedAt: new Date(), nextAttemptAt: new Date() }],
    ['dispatching without dispatchedAt', { status: 'dispatching' }],
    ['cancelled without a reason', { status: 'cancelled', cancelledAt: new Date(), finalizedAt: new Date() }],
    ['failed without a reason', { status: 'failed', finalizedAt: new Date() }],
    ['discarded without a reason', { status: 'discarded', finalizedAt: new Date(), text: null }],
    ['a terminal state without finalizedAt', { status: 'unknown', dispatchedAt: new Date() }],
    ['scheduled without nextAttemptAt', { status: 'scheduled' }],
  ])('rejects %s', async (_label, over) => {
    const o = await seedOwner('lifecycle')
    const id = await insertDraft(o)
    expect(await pgCode(update(id, over))).toBe('23514')
  })

  it('text longer than 300 is rejected by the column type (22001)', async () => {
    const o = await seedOwner('chk-len')
    expect(await pgCode(insertDraft(o, { text: 'א'.repeat(301), textLength: 300 }))).toBe('22001')
  })

  it('text may be NULL only when purged or discarded', async () => {
    const o = await seedOwner('text-null')
    const id = await insertDraft(o)
    await update(id, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_t_v1_create' })
    expect(await pgCode(update(id, { text: null }))).toBe('23514')
    expect(await pgCode(update(id, { text: null, textPurgedAt: new Date() }))).toBeNull()
    expect(await db(T).where({ id }).first('textLength')).toEqual({ textLength: 11 })
  })
})

describe('the guard trigger', () => {
  const RESTRICT = '23001'
  it.each([['agencyId'], ['userId'], ['recipientId'], ['sourceWamid'], ['anchorMessageTs'], ['textLength']])(
    '%s is immutable',
    async (col) => {
      const o = await seedOwner('immut')
      const id = await insertDraft(o)
      const value = col === 'agencyId' ? B.agencyId : col === 'userId' ? B.userId : col === 'recipientId' ? B.recipientId : col === 'sourceWamid' ? 'other' : 7
      expect(await pgCode(update(id, { [col]: value }))).toBe(RESTRICT)
    },
  )

  it('text can be purged but never changed', async () => {
    const o = await seedOwner('text')
    const id = await insertDraft(o)
    expect(await pgCode(update(id, { text: 'משהו אחר' }))).toBe(RESTRICT)
  })

  it('there is no transition back to proposed', async () => {
    const o = await seedOwner('back')
    const id = await insertDraft(o)
    await update(id, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_b_v1_create' })
    expect(await pgCode(update(id, { status: 'proposed' }))).toBe(RESTRICT)
  })

  it('createdByActionId is set only together with leaving proposed, and never changes', async () => {
    const o = await seedOwner('cba')
    const id = await insertDraft(o)
    expect(await pgCode(update(id, { createdByActionId: 'rem_c_v1_create' }))).toBe(RESTRICT)
    await update(id, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_c_v1_create' })
    expect(await pgCode(update(id, { createdByActionId: 'rem_c_v2_create' }))).toBe(RESTRICT)
  })

  it('proposalActionId is immutable once set', async () => {
    const o = await seedOwner('pai')
    const id = await insertDraft(o, { proposalActionId: 'rem_p_v1_create' })
    expect(await pgCode(update(id, { proposalActionId: 'rem_p_v2_create' }))).toBe(RESTRICT)
  })

  it('ordinary lifecycle updates pass', async () => {
    const o = await seedOwner('ok')
    const id = await insertDraft(o)
    await update(id, { status: 'scheduled', nextAttemptAt: new Date(Date.now() + HOUR), createdByActionId: 'rem_o_v1_create' })
    await update(id, { status: 'claimed', claimToken: '00000000-0000-4000-8000-000000000001', claimedAt: new Date(), attempts: 1 })
    await update(id, { status: 'dispatching', dispatchedAt: new Date() })
    await update(id, { status: 'sent', wamid: `wamid.out.${id}`, sentAt: new Date(), finalizedAt: new Date() })
    expect(await db(T).where({ id }).first('status')).toEqual({ status: 'sent' })
  })

  it('deleting the agency cascades (deletion stays possible)', async () => {
    const o = await seedOwner('cascade')
    await insertDraft(o)
    await db('owner_whatsapp_recipients').where({ id: o.recipientId }).del()
    expect(await db(T).where({ recipientId: o.recipientId })).toHaveLength(0)
  })
})

describe('audit, capacity and provenance tables', () => {
  it('the events table has no free-text or JSON column', async () => {
    const { rows } = await db.raw(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'owner_personal_reminder_events'`,
    )
    const names = rows.map((r: { column_name: string }) => r.column_name)
    expect(names).not.toContain('text')
    expect(names).not.toContain('detail')
    expect(rows.filter((r: { data_type: string }) => r.data_type === 'jsonb' || r.data_type === 'json')).toHaveLength(0)
  })

  it('events: types, actor kinds and reason length are checked', async () => {
    const base = { agencyId: A.agencyId, type: 'discarded', actorKind: 'system' }
    expect(await pgCode(db('owner_personal_reminder_events').insert(base))).toBeNull()
    expect(await pgCode(db('owner_personal_reminder_events').insert({ ...base, type: 'free_text' }))).toBe('23514')
    expect(await pgCode(db('owner_personal_reminder_events').insert({ ...base, actorKind: 'model' }))).toBe('23514')
    expect(await pgCode(db('owner_personal_reminder_events').insert({ ...base, reason: 'x'.repeat(41) }))).toBe('23514')
  })

  it('capacity: one row per scope and period, never negative', async () => {
    const row = { scopeKind: 'recipient', scopeId: A.recipientId, periodStart: '2026-11-08', reserved: 1 }
    await db('owner_reminder_send_capacity').insert(row)
    expect(await pgCode(db('owner_reminder_send_capacity').insert(row))).toBe('23505')
    expect(await pgCode(db('owner_reminder_send_capacity').insert({ ...row, scopeKind: 'galaxy' }))).toBe('23514')
    expect(await pgCode(db('owner_reminder_send_capacity').insert({ ...row, periodStart: '2026-11-09', reserved: -1 }))).toBe('23514')
  })

  it.each(['platform_whatsapp_inbound', 'wa_assistant_jobs'])('%s.timestampSource accepts meta, server and NULL only', async (table) => {
    const { rows } = await db.raw(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ?`,
      [`${table}_timestamp_source_check`],
    )
    expect(rows[0].def).toMatch(/'meta'.*'server'/)
  })
})
