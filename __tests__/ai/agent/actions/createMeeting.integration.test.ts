/**
 * `create_meeting` — the third action, and the first where TIME is real.
 *
 * A task stores a date and a follow-up stores a date, so both were built around
 * the rule that SocialCRM keeps no time of day. A meeting breaks that rule
 * honestly: `meetings.start_at`/`end_at` are instants and the row carries its own
 * timezone. So the questions this file answers are the ones the previous two
 * could not raise — does the wall-clock time a rep said survive the round trip
 * to UTC and back, and is duration really the gap between two instants.
 *
 * It also re-asks every question the runtime has already answered twice, because
 * "the runtime is generic" is a claim that has to keep being true for a third
 * action shaped differently from the first two.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { findActionByActionId } from '@/db/agentActions'
import { getMeeting } from '@/db/meetings'
import { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import { registerDomainActions, createMeetingAction } from '@/lib/agent/actions/domain'
import { businessInstantMs } from '@/lib/today/time'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'

const AGENCY_A = 95_001
const AGENCY_B = 95_002
const ADMIN_A = 95_101
const ADMIN_B = 95_102
const REP_A = 95_103
let LEAD_A = 0
let LEAD_B = 0
let LEAD_OWNED = 0

const DATE = '2026-09-10'
const TIME = '10:00'
const COMMAND = 'תקבע פגישה עם דניאל כהן מחר ב-10'

const adminA = (): AgentScope => ({ agencyId: AGENCY_A, userId: ADMIN_A, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const adminB = (): AgentScope => ({ agencyId: AGENCY_B, userId: ADMIN_B, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' })
const rep = (gotPermIds: number[]): AgentScope => ({ agencyId: AGENCY_A, userId: REP_A, role: Roles.AGNT, gotPermIds, plan: 'pro', firstName: 'נ' })

function meeting(clientId: number, over: Partial<{ title: string; date: string; startTime: string; durationMinutes: number; note: string | null }> = {}): ProposedAction {
  return {
    actionType: 'create_meeting',
    args: {
      clientId, title: 'פגישת מכירה', date: DATE, startTime: TIME, durationMinutes: 45, note: null,
      ...over,
    },
    evidenceRefs: [`lead:${clientId}`],
  }
}

let seq = 0
const submit = (p: ProposedAction, scope: AgentScope, userMessage: string, runId?: string) =>
  submitProposedAction({ proposal: p, scope, agentRunId: runId ?? `run_mt_${++seq}`, userMessage }) as Promise<ActionOutcome>

const meetingsFor = (leadId: number) => db('meetings').where({ lead_id: leadId })

async function seedAgency(agencyId: number, adminId: number): Promise<number> {
  await db('agencies').insert({
    id: agencyId, name: `mt-${agencyId}`, plan: 'pro', country: 'IL',
    defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: adminId, agencyId, email: `m${adminId}@t.test`, role: 'ADMIN', firstName: 'מנהל', lastName: String(adminId) })
    .onConflict('id').ignore()
  const [row] = await db('clients').insert({ firstName: 'דניאל', lastName: String(agencyId), agencyId, createdById: adminId, lead: true }).returning('id')
  return typeof row === 'object' ? (row as { id: number }).id : (row as number)
}

beforeAll(async () => {
  enableAgentFor([AGENCY_A, AGENCY_B])
  registerDomainActions()
  LEAD_A = await seedAgency(AGENCY_A, ADMIN_A)
  LEAD_B = await seedAgency(AGENCY_B, ADMIN_B)
  await db('users').insert({ id: REP_A, agencyId: AGENCY_A, email: `m${REP_A}@t.test`, role: 'AGNT', firstName: 'נציג', lastName: 'א' })
    .onConflict('id').ignore()
  const [owned] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'שלי', agencyId: AGENCY_A, createdById: ADMIN_A, userId: REP_A, lead: true })
    .returning('id')
  LEAD_OWNED = typeof owned === 'object' ? (owned as { id: number }).id : (owned as number)
})

afterEach(async () => {
  await db('meetings').whereIn('lead_id', [LEAD_A, LEAD_B, LEAD_OWNED]).del()
  // The automation emit writes here; clearing it keeps each test independent.
  await db('analytics_events').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

afterAll(async () => {
  restoreAgentRollout()
  await db('analytics_events').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('clients').whereIn('id', [LEAD_A, LEAD_B, LEAD_OWNED]).del()
  await db('users').whereIn('id', [ADMIN_A, ADMIN_B, REP_A]).del()
  await db('agencies').whereIn('id', [AGENCY_A, AGENCY_B]).del()
})

// ── time is real ────────────────────────────────────────────────────────────

describe('the time a rep said is the time that is stored', () => {
  it('persists the wall-clock time in the business timezone, not the server\'s', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    expect(out.report).toBe('VERIFIED_SUCCESS')

    const row = (await meetingsFor(LEAD_A).first())!
    /**
     * The bug this pins: `new Date('2026-09-10T10:00')` on a UTC server is 10:00
     * UTC — 13:00 in Jerusalem — so every meeting would be three hours late,
     * invisibly and forever.
     */
    expect(new Date(row.start_at).getTime()).toBe(businessInstantMs(DATE, TIME))
    expect(new Date(row.start_at).toISOString()).toBe('2026-09-10T07:00:00.000Z')
    expect(row.timezone).toBe(BUSINESS_TZ)
  })

  it('expresses duration the way the table does — as an end instant', async () => {
    await submit(meeting(LEAD_A, { durationMinutes: 90 }), adminA(), COMMAND)
    const row = (await meetingsFor(LEAD_A).first())!
    const minutes = (new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000
    expect(minutes).toBe(90)
  })

  it('survives a DST boundary without drifting an hour', async () => {
    // Israel leaves DST in late October; 10:00 must still be 10:00 locally.
    await submit(meeting(LEAD_A, { date: '2026-10-25' }), adminA(), COMMAND)
    const row = (await meetingsFor(LEAD_A).first())!
    expect(new Date(row.start_at).getTime()).toBe(businessInstantMs('2026-10-25', '10:00'))
    expect(new Date(row.start_at).toISOString()).toBe('2026-10-25T08:00:00.000Z')
  })

  it('is created as scheduled, and NOT mirrored to any calendar provider', async () => {
    await submit(meeting(LEAD_A), adminA(), COMMAND)
    const row = (await meetingsFor(LEAD_A).first())!
    expect(row.status).toBe('scheduled')
    // Deliberate: this phase creates a real CRM meeting and leaves the mirror to
    // the existing user-triggered retry. Nothing pretends it was pushed.
    expect(row.sync_status).toBe('pending')
    expect(row.google_event_id).toBeNull()
  })
})

// ── authorization ───────────────────────────────────────────────────────────

describe('authorization behaves exactly as it does for the other two actions', () => {
  it('an explicit command executes with no approval', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    expect(out.approval).toBe('NOT_REQUIRED')
    expect(out.report).toBe('VERIFIED_SUCCESS')
  })

  it('an agent-initiated meeting waits for approval and writes nothing', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), 'מה הבעיה הכי גדולה שלי?')
    expect(out.report).toBe('AWAITING_APPROVAL')
    expect(await meetingsFor(LEAD_A)).toHaveLength(0)
  })

  it('approval then executes it', async () => {
    const proposed = await submit(meeting(LEAD_A), adminA(), 'מה קורה בעסק?')
    const decided = await decideOnAction({
      actionId: proposed.actionId, argsHash: proposed.argsHash, decision: 'APPROVED', scope: adminA(),
    })
    expect(decided.ok && decided.outcome.report).toBe('VERIFIED_SUCCESS')
    expect(await meetingsFor(LEAD_A)).toHaveLength(1)
  })

  it('a hedged request never executes', async () => {
    for (const message of ['אולי כדאי לקבוע פגישה עם דניאל', 'מה דעתך על פגישה מחר?']) {
      const out = await submit(meeting(LEAD_A), adminA(), message)
      expect(out.report, message).toBe('AWAITING_APPROVAL')
    }
    expect(await meetingsFor(LEAD_A)).toHaveLength(0)
  })
})

// ── identity and tenancy ────────────────────────────────────────────────────

describe('identity and tenancy', () => {
  it('refuses a cross-tenant lead and writes nothing', async () => {
    const out = await submit(meeting(LEAD_B), adminA(), COMMAND)
    expect(out.execution).toMatchObject({ status: 'NOT_AUTHORIZED', reason: 'lead-not-in-agency' })
    expect(await meetingsFor(LEAD_B)).toHaveLength(0)
  })

  it('ignores forged agency and actor fields', async () => {
    const forged = { ...meeting(LEAD_A), agencyId: AGENCY_B, actor: { agencyId: AGENCY_B, userId: ADMIN_B } } as unknown as ProposedAction
    const out = await submit(forged, adminA(), COMMAND)
    expect(out.agencyId).toBe(AGENCY_A)
    const row = (await meetingsFor(LEAD_A).first())!
    // Organised by the authenticated actor, inside the authenticated agency.
    expect(row.agency_id).toBe(AGENCY_A)
    expect(row.organizer_user_id).toBe(ADMIN_A)
  })

  it('holds a non-admin to the leads they own', async () => {
    const denied = await submit(meeting(LEAD_A), rep([]), COMMAND)
    expect(denied.execution.status).toBe('NOT_AUTHORIZED')
    expect(await meetingsFor(LEAD_A)).toHaveLength(0)

    const allowed = await submit(meeting(LEAD_OWNED), rep([REP_A]), COMMAND)
    expect(allowed.report).toBe('VERIFIED_SUCCESS')
    expect((await meetingsFor(LEAD_OWNED).first())!.organizer_user_id).toBe(REP_A)
  })

  it('an admin in another agency cannot reach this meeting at all', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    const id = Number(out.verification!.targetIds![0]!.id)
    expect(await getMeeting(id, AGENCY_A)).not.toBeNull()
    expect(await getMeeting(id, AGENCY_B)).toBeNull()
    expect(await findActionByActionId(AGENCY_B, out.actionId)).toBeNull()
    void adminB
  })
})

// ── malformed input ─────────────────────────────────────────────────────────

describe('nothing malformed reaches the table', () => {
  it('refuses a missing or bad required field before any write', async () => {
    const bad: Array<Partial<{ title: string; date: string; startTime: string; durationMinutes: number }>> = [
      { title: '' },
      { date: '10/9/2026' },
      { startTime: '25:00' },
      { startTime: '10' },
      { durationMinutes: 0 },
      { durationMinutes: 5000 },
    ]
    for (const over of bad) {
      const out = await submit(meeting(LEAD_A, over), adminA(), COMMAND)
      expect(out.execution, JSON.stringify(over)).toMatchObject({ status: 'INVALID_ACTION', reason: 'invalid-args' })
    }
    expect(await meetingsFor(LEAD_A)).toHaveLength(0)
  })

  it('a lead that does not exist writes nothing', async () => {
    const out = await submit(meeting(99_999_999), adminA(), COMMAND)
    expect(out.execution.status).toBe('NOT_AUTHORIZED')
  })
})

// ── idempotency ─────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('the same command replayed creates one meeting', async () => {
    const a = await submit(meeting(LEAD_A), adminA(), COMMAND, 'run_mt_dupe')
    const b = await submit(meeting(LEAD_A), adminA(), COMMAND, 'run_mt_dupe')
    expect(a.report).toBe('VERIFIED_SUCCESS')
    expect(b.report).toBe('DUPLICATE_NOOP')
    expect(await meetingsFor(LEAD_A)).toHaveLength(1)
  })

  it('concurrent identical execution creates one meeting', async () => {
    const outs = (await Promise.all([
      submit(meeting(LEAD_A), adminA(), COMMAND, 'run_mt_conc'),
      submit(meeting(LEAD_A), adminA(), COMMAND, 'run_mt_conc'),
      submit(meeting(LEAD_A), adminA(), COMMAND, 'run_mt_conc'),
    ])) as ActionOutcome[]
    expect(outs.filter((o) => o.report === 'VERIFIED_SUCCESS')).toHaveLength(1)
    expect(await meetingsFor(LEAD_A)).toHaveLength(1)
  })

  it('a different time is a different meeting', async () => {
    await submit(meeting(LEAD_A, { startTime: '10:00' }), adminA(), COMMAND, 'run_mt_time')
    const second = await submit(meeting(LEAD_A, { startTime: '16:00' }), adminA(), COMMAND, 'run_mt_time')
    expect(second.report).toBe('VERIFIED_SUCCESS')
    expect(await meetingsFor(LEAD_A)).toHaveLength(2)
  })
})

// ── verification ────────────────────────────────────────────────────────────

describe('verification', () => {
  it('checks every postcondition the model asked for', async () => {
    const out = await submit(meeting(LEAD_A, { note: 'להביא מצגת' }), adminA(), COMMAND)
    expect(out.verification!.checks.map((c) => c.name).sort())
      .toEqual(['agencyOwnership', 'clientId', 'durationMinutes', 'note', 'scheduled', 'startAt', 'title'])
    expect(out.verification!.checks.every((c) => c.ok)).toBe(true)
    expect(out.verification!.targetIds![0]!.label).toBe(`דניאל ${AGENCY_A}`)
  })

  it('reports MISMATCH when the row is not what was asked for', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    const id = out.verification!.targetIds![0]!.id
    const v = await createMeetingAction.verify(
      { args: { clientId: LEAD_A, title: 'כותרת אחרת', date: DATE, startTime: '16:00', durationMinutes: 45, note: null } } as never,
      { status: 'SUCCESS', targetIds: [{ kind: 'meeting', id }] },
      { actor: { agencyId: AGENCY_A, userId: ADMIN_A, role: 'ADMIN', gotPermIds: [] }, deadlineAtMs: Date.now() + 40_000, nowMs: Date.now() },
    )
    expect(v.verified).toBe(false)
    expect(v.state).toBe('MISMATCH')
    expect(v.checks.find((c) => c.name === 'startAt')?.ok).toBe(false)
    expect(v.checks.find((c) => c.name === 'title')?.ok).toBe(false)
  })

  it('a meeting in another agency is NOT_FOUND, never verified', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    const id = out.verification!.targetIds![0]!.id
    const v = await createMeetingAction.verify(
      { args: { clientId: LEAD_A, title: 'פגישת מכירה', date: DATE, startTime: TIME, durationMinutes: 45, note: null } } as never,
      { status: 'SUCCESS', targetIds: [{ kind: 'meeting', id }] },
      { actor: { agencyId: AGENCY_B, userId: ADMIN_B, role: 'ADMIN', gotPermIds: [] }, deadlineAtMs: Date.now() + 40_000, nowMs: Date.now() },
    )
    expect(v.state).toBe('NOT_FOUND')
    expect(v.verified).toBe(false)
  })
})

// ── the conversation around it ──────────────────────────────────────────────

describe('slot filling and the standing-command lifecycle', () => {
  const COMMAND_TURN = 'תיצור פגישה עם דניאל כהן'
  const submitWith = (p: ProposedAction, userMessage: string, priorUserMessages: string[], runId?: string) =>
    submitProposedAction({
      proposal: p, scope: adminA(), agentRunId: runId ?? `run_mtc_${++seq}`,
      userMessage, priorUserMessages, priorAssistantMessage: 'מה כותרת הפגישה, ובאיזה תאריך ושעה?',
    }) as Promise<ActionOutcome>

  it('a completion turn inherits the command and executes', async () => {
    // "תיצור פגישה" → agent asks → "פגישת מכירה מחר ב-10" carries no verb of its
    // own, and must still be the instruction being filled in.
    const out = await submitWith(meeting(LEAD_A), 'פגישת מכירה מחר ב-10', [COMMAND_TURN])
    expect(out.report).toBe('VERIFIED_SUCCESS')
  })

  it('a duration supplied on a later turn still inherits', async () => {
    const out = await submitWith(meeting(LEAD_A, { durationMinutes: 30 }), 'חצי שעה', ['פגישת מכירה מחר ב-10', COMMAND_TURN])
    expect(out.report).toBe('VERIFIED_SUCCESS')
    const row = (await meetingsFor(LEAD_A).first())!
    expect((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000).toBe(30)
  })

  it('a spent command cannot authorise a NEW meeting', async () => {
    const first = await submitWith(meeting(LEAD_A), 'פגישת מכירה מחר ב-10', [COMMAND_TURN])
    expect(first.report).toBe('VERIFIED_SUCCESS')

    // A fragment after the command was carried out. Still inside the window,
    // still carrying no instruction — and the command is spent.
    const after = await submitWith(
      meeting(LEAD_A, { startTime: '16:00' }),
      'פגישה נוספת',
      ['פגישת מכירה מחר ב-10', COMMAND_TURN],
    )
    expect(after.report).toBe('AWAITING_APPROVAL')
    expect(await meetingsFor(LEAD_A)).toHaveLength(1)
  })

  it('but a NEW explicit command executes on its own words', async () => {
    await submitWith(meeting(LEAD_A), 'פגישת מכירה מחר ב-10', [COMMAND_TURN])
    const second = await submitWith(
      meeting(LEAD_A, { startTime: '16:00' }),
      'תקבע גם פגישה ב-16:00',
      ['פגישת מכירה מחר ב-10', COMMAND_TURN],
    )
    expect(second.report).toBe('VERIFIED_SUCCESS')
    expect(await meetingsFor(LEAD_A)).toHaveLength(2)
  })

  it('context survives while authorization closes', async () => {
    await submitWith(meeting(LEAD_A), 'פגישת מכירה מחר ב-10', [COMMAND_TURN])
    const after = await submitWith(meeting(LEAD_A, { startTime: '16:00' }), 'פגישה נוספת', [COMMAND_TURN])
    expect(after.report).toBe('AWAITING_APPROVAL')
    // The pending action still knows the lead — the system forgot nothing, it
    // simply will not act unasked.
    const row = await findActionByActionId(AGENCY_A, after.actionId)
    expect(row!.args.clientId).toBe(LEAD_A)
  })
})

// ── the automation the product already had ──────────────────────────────────

describe('a meeting the agent books behaves like one booked by hand', () => {
  it('emits the appointment_booked automation event', async () => {
    /**
     * The product's own action fires this BEFORE any mirroring, because the
     * occurrence is true the moment the row exists. Dropping it here would mean
     * an agent-booked meeting silently never reminds the lead while an identical
     * hand-booked one does — a divergence nobody finds until a customer misses
     * an appointment.
     */
    await submit(meeting(LEAD_A), adminA(), COMMAND)
    const events = await db('analytics_events').where({ agencyId: AGENCY_A })
    expect(events.length).toBeGreaterThan(0)
  })
})

// ── audit ───────────────────────────────────────────────────────────────────

describe('the audit records the meeting like any other action', () => {
  it('carries type, intent, approval and verification', async () => {
    const out = await submit(meeting(LEAD_A), adminA(), COMMAND)
    const row = await findActionByActionId(AGENCY_A, out.actionId)
    expect(row).toMatchObject({
      actionType: 'create_meeting', risk: 'LOW_RISK_WRITE', intent: 'EXPLICIT_COMMAND',
      approvalState: 'NOT_REQUIRED', executionState: 'SUCCEEDED', verificationState: 'VERIFIED',
    })
    expect(row!.targetIds[0]!.kind).toBe('meeting')
  })
})
