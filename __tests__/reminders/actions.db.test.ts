/**
 * Personal-reminder actions through the REAL bridge, runtime and Postgres store
 * (architecture v1.5 §3, v1.6 §2): stable action identity, at-most-once
 * scheduling, execution-time window and limit checks, ownership, cancel and
 * reschedule semantics, and T16 reconciliation with the guarded write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from '../ai/agent/actions/_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { decideOnAction, submitProposedAction } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { scheduleApprovedDraft } from '@/db/ownerPersonalReminders/schedule'
import { reconcileReminderActions } from '@/lib/reminders/reconcileSweep'
import { reminderActionId } from '@/lib/reminders/limits'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'
import { insertDraft, seedOwner, type Owner } from './fixtures'

const T = 'owner_personal_reminders'
const MIN = 60_000
const owners: Owner[] = []
let A: Owner
let B: Owner
let seq = 0

const scope = (o: Owner): AgentScope => ({ agencyId: o.agencyId, userId: o.userId, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const row = (id: number) => db(T).where({ id }).first()

async function owner(name: string): Promise<Owner> {
  const o = await seedOwner(name)
  await db('agencies').where({ id: o.agencyId }).update({ plan: 'pro' })
  owners.push(o)
  enableAgentFor(owners.map((x) => x.agencyId))
  return o
}

/** A draft due in `inMs`, anchored now, with its proposal action id recorded. */
async function draft(o: Owner, inMs = 30 * MIN, over: Record<string, unknown> = {}) {
  const remindAt = new Date(Date.now() + inMs)
  const id = await insertDraft(o, { remindAt, ...over })
  const actionId = reminderActionId('create', id, 1)
  await db(T).where({ id }).update({ proposalActionId: actionId })
  return { id, actionId, remindAt }
}

async function submitCreate(o: Owner, d: { id: number; actionId: string; remindAt: Date }, runId = `run_${++seq}`) {
  return submitProposedAction({
    proposal: { actionType: 'create_reminder', args: { reminderId: d.id, version: 1, remindAt: d.remindAt.toISOString() }, evidenceRefs: [] },
    scope: scope(o),
    agentRunId: runId,
    identity: { actionId: d.actionId, idempotencyKey: d.actionId },
  })
}

const approve = (o: Owner, actionId: string, argsHash: string, nowMs = Date.now()) =>
  decideOnAction({ actionId, argsHash, decision: 'APPROVED', scope: scope(o), nowMs })

/** A live reminder inserted directly (status `scheduled`), for the limit tests. */
async function insertScheduled(o: Owner, remindAt: Date) {
  const n = ++seq
  await db(T).insert({
    agencyId: o.agencyId, userId: o.userId, recipientId: o.recipientId, text: 'x', textLength: 1, remindAt,
    anchorMessageTs: Math.floor(Date.now() / 1000), sourceWamid: `wamid.sched.${n}`, status: 'scheduled',
    nextAttemptAt: remindAt, createdByActionId: `rem_${900000 + n}_v1_create`,
  })
}

beforeAll(async () => {
  registerDomainActions()
  A = await owner('act-a')
  B = await owner('act-b')
})
afterAll(async () => {
  restoreAgentRollout()
  await db.destroy()
})

describe('stable action identity (v1.5 §3.2)', () => {
  it('the same request submitted twice maps to the SAME action id and one agent_actions row', async () => {
    const d = await draft(A)
    const one = await submitCreate(A, d)
    const two = await submitCreate(A, d)
    expect(one?.report).toBe('AWAITING_APPROVAL')
    expect(two?.actionId).toBe(d.actionId)
    expect(one?.actionId).toBe(d.actionId)
    expect(await db('agent_actions').where({ agencyId: A.agencyId, actionId: d.actionId })).toHaveLength(1)
  })

  it('regression: without an identity, a re-submit reports a different action id than the stored row', async () => {
    const o = await owner('act-random')
    const d = await draft(o)
    const proposal = { actionType: 'create_reminder' as const, args: { reminderId: d.id, version: 1, remindAt: d.remindAt.toISOString() }, evidenceRefs: [] }
    const one = await submitProposedAction({ proposal, scope: scope(o), agentRunId: 'same-run' })
    const two = await submitProposedAction({ proposal, scope: scope(o), agentRunId: 'same-run' })
    expect(one?.actionId).not.toBe(two?.actionId) // the defect the identity fixes
  })
})

describe('create_reminder: approval schedules the draft at most once', () => {
  it('approve → scheduled with this action as creator, one event, verified', async () => {
    const o = await owner('act-ok')
    const d = await draft(o)
    const s = await submitCreate(o, d)
    const decided = await approve(o, d.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(await row(d.id)).toMatchObject({ status: 'scheduled', createdByActionId: d.actionId })
    expect(await db('owner_personal_reminder_events').where({ reminderId: d.id, type: 'scheduled' })).toHaveLength(1)
  })

  it('a duplicate approval writes nothing twice', async () => {
    const o = await owner('act-dup')
    const d = await draft(o)
    const s = await submitCreate(o, d)
    await approve(o, d.actionId, s!.argsHash)
    await approve(o, d.actionId, s!.argsHash)
    expect(await db('owner_personal_reminder_events').where({ reminderId: d.id, type: 'scheduled' })).toHaveLength(1)
  })

  it('the executor replays: the same action twice → second is a no-op success', async () => {
    const o = await owner('act-replay')
    const d = await draft(o)
    const input = { reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: o, nowMs: Date.now() }
    expect((await scheduleApprovedDraft(input)).kind).toBe('scheduled')
    expect((await scheduleApprovedDraft(input)).kind).toBe('replayed')
  })

  it('two different actions on one draft at once → exactly one schedules', async () => {
    const o = await owner('act-race')
    const d = await draft(o)
    const base = { reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), owner: o, nowMs: Date.now() }
    const [x, y] = await Promise.all([scheduleApprovedDraft({ ...base, actionId: 'rem_race_v1_a' }), scheduleApprovedDraft({ ...base, actionId: 'rem_race_v1_b' })])
    expect([x.kind, y.kind].sort()).toEqual(['refused', 'scheduled'])
    expect(await row(d.id)).toMatchObject({ status: 'scheduled' })
  })

  it.each([
    ['lead_time', 59_000, {}],
    ['due_passed', -MIN, { createdAt: new Date(Date.now() - 10 * MIN) }],
    ['horizon', 30 * MIN, { anchorMessageTs: Math.floor((Date.now() - 24 * 3_600_000) / 1000) }],
  ])('outside the window at execution (%s) → discarded with that reason, FAILED', async (reason, inMs, over) => {
    const o = await owner(`act-${reason}`)
    const d = await draft(o, inMs as number, over as Record<string, unknown>)
    const r = await scheduleApprovedDraft({ reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: o, nowMs: Date.now() })
    expect(r).toEqual({ kind: 'rejected', reason })
    expect(await row(d.id)).toMatchObject({ status: 'discarded', discardReason: reason, text: null })
  })

  it('the 50-live limit → discarded as forecast', async () => {
    const o = await owner('act-50')
    for (let i = 0; i < 50; i++) await insertScheduled(o, new Date(Date.now() + (i % 20) * 86_400_000 + 3_600_000))
    const d = await draft(o)
    const r = await scheduleApprovedDraft({ reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: o, nowMs: Date.now() })
    expect(r).toEqual({ kind: 'rejected', reason: 'forecast' })
  })

  it('30 for the recipient on that business day → discarded as forecast', async () => {
    const o = await owner('act-30')
    const d = await draft(o, 2 * 3_600_000)
    for (let i = 0; i < 30; i++) await insertScheduled(o, new Date(d.remindAt.getTime() + i * 1000))
    const r = await scheduleApprovedDraft({ reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: o, nowMs: Date.now() })
    expect(r).toEqual({ kind: 'rejected', reason: 'forecast' })
  })

  it("another owner's draft → not_found (NOT_AUTHORIZED), nothing changed", async () => {
    const victim = await owner('act-victim') // a fresh owner: one live draft per recipient
    const d = await draft(victim)
    const r = await scheduleApprovedDraft({ reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: B, nowMs: Date.now() })
    expect(r).toEqual({ kind: 'not_found' })
    expect(await row(d.id)).toMatchObject({ status: 'proposed' })
  })
})

async function scheduled(o: Owner) {
  const d = await draft(o)
  await scheduleApprovedDraft({ reminderId: d.id, version: 1, remindAtMs: d.remindAt.getTime(), actionId: d.actionId, owner: o, nowMs: Date.now() })
  return d
}

const submitChange = (o: Owner, actionType: 'cancel_reminder' | 'reschedule_reminder', args: Record<string, unknown>, op: 'cancel' | 'reschedule') => {
  const actionId = reminderActionId(op, args.reminderId as number, args.version as number)
  return submitProposedAction({ proposal: { actionType, args, evidenceRefs: [] }, scope: scope(o), agentRunId: `run_${++seq}`, identity: { actionId, idempotencyKey: actionId } })
}

describe('cancel_reminder', () => {
  it('scheduled → cancelled by the owner, with an event', async () => {
    const o = await owner('cx-ok')
    const d = await scheduled(o)
    const s = await submitChange(o, 'cancel_reminder', { reminderId: d.id, version: 1 }, 'cancel')
    const decided = await approve(o, s!.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(await row(d.id)).toMatchObject({ status: 'cancelled', cancelReason: 'owner' })
    expect(await db('owner_personal_reminder_events').where({ reminderId: d.id, type: 'cancelled' })).toHaveLength(1)
  })

  it('already dispatching → an honest FAILED (in_flight), nothing changed', async () => {
    const o = await owner('cx-flight')
    const d = await scheduled(o)
    await db(T).where({ id: d.id }).update({ status: 'dispatching', dispatchedAt: new Date() })
    const s = await submitChange(o, 'cancel_reminder', { reminderId: d.id, version: 1 }, 'cancel')
    const decided = await approve(o, s!.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.execution?.reason).toBe('in_flight')
    expect(await row(d.id)).toMatchObject({ status: 'dispatching' })
  })

  it('an outdated card (stale version) changes nothing', async () => {
    const o = await owner('cx-stale')
    const d = await scheduled(o)
    await db(T).where({ id: d.id }).update({ version: 2 })
    const s = await submitChange(o, 'cancel_reminder', { reminderId: d.id, version: 1 }, 'cancel')
    const decided = await approve(o, s!.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.execution?.status).toBe('INVALID_ACTION')
    expect(await row(d.id)).toMatchObject({ status: 'scheduled' })
  })
})

describe('reschedule_reminder', () => {
  it('moves the time, bumps the version, records before/after', async () => {
    const o = await owner('rs-ok')
    const d = await scheduled(o)
    const to = new Date(d.remindAt.getTime() + 60 * MIN)
    const s = await submitChange(o, 'reschedule_reminder', { reminderId: d.id, version: 1, remindAt: to.toISOString(), requestAnchorMs: Date.now() }, 'reschedule')
    const decided = await approve(o, s!.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.report).toBe('VERIFIED_SUCCESS')
    const r = await row(d.id)
    expect(r).toMatchObject({ version: 2, status: 'scheduled' })
    expect(new Date(r.remindAt).getTime()).toBe(to.getTime())
    const [ev] = await db('owner_personal_reminder_events').where({ reminderId: d.id, type: 'rescheduled' })
    expect(ev).toMatchObject({ versionAfter: 2 })
  })

  it('a claimed reminder (about to send) is not rescheduled', async () => {
    const o = await owner('rs-claimed')
    const d = await scheduled(o)
    await db(T).where({ id: d.id }).update({ status: 'claimed', claimToken: '00000000-0000-4000-8000-000000000009', claimedAt: new Date() })
    const to = new Date(d.remindAt.getTime() + 60 * MIN)
    const s = await submitChange(o, 'reschedule_reminder', { reminderId: d.id, version: 1, remindAt: to.toISOString(), requestAnchorMs: Date.now() }, 'reschedule')
    const decided = await approve(o, s!.actionId, s!.argsHash)
    expect(decided.ok && decided.outcome.execution?.reason).toBe('not_reschedulable')
  })
})

describe('T16 reconciliation (guarded Postgres write)', () => {
  async function stuck(o: Owner, prepare: (d: { id: number; actionId: string }) => Promise<void>) {
    const d = await draft(o)
    await submitCreate(o, d)
    await prepare(d)
    await db('agent_actions')
      .where({ agencyId: o.agencyId, actionId: d.actionId })
      .update({ executionState: 'EXECUTING', updatedAt: new Date(Date.now() - 5 * MIN) })
    return d
  }
  const state = (o: Owner, actionId: string) => db('agent_actions').where({ agencyId: o.agencyId, actionId }).first('executionState', 'retryable')

  it('the scheduling landed → SUCCEEDED', async () => {
    const o = await owner('t16-landed')
    const d = await stuck(o, async (x) => {
      await db(T).where({ id: x.id }).update({ status: 'scheduled', nextAttemptAt: new Date(Date.now() + 30 * MIN), createdByActionId: x.actionId })
    })
    await reconcileReminderActions(Date.now())
    expect(await state(o, d.actionId)).toMatchObject({ executionState: 'SUCCEEDED' })
  })

  it('it did not land (draft still proposed) → FAILED, retryable', async () => {
    const o = await owner('t16-absent')
    const d = await stuck(o, async () => {})
    await reconcileReminderActions(Date.now())
    expect(await state(o, d.actionId)).toMatchObject({ executionState: 'FAILED', retryable: true })
  })

  it('scheduled by a different action → left for a person (stays EXECUTING)', async () => {
    const o = await owner('t16-other')
    const d = await stuck(o, async (x) => {
      await db(T).where({ id: x.id }).update({ status: 'scheduled', nextAttemptAt: new Date(Date.now() + 30 * MIN), createdByActionId: 'rem_other_v1_create' })
    })
    await reconcileReminderActions(Date.now())
    expect(await state(o, d.actionId)).toMatchObject({ executionState: 'EXECUTING' })
  })

  it('a second sweep changes nothing', async () => {
    const o = await owner('t16-idem')
    const d = await stuck(o, async () => {})
    await reconcileReminderActions(Date.now())
    const first = await db('agent_actions').where({ agencyId: o.agencyId, actionId: d.actionId }).first('updatedAt')
    await reconcileReminderActions(Date.now())
    expect(await db('agent_actions').where({ agencyId: o.agencyId, actionId: d.actionId }).first('updatedAt')).toEqual(first)
  })
})
