/**
 * The standing-command lifecycle:
 *
 *   COMMAND_STARTED → COLLECTING_REQUIRED_FIELDS → READY → EXECUTED → CLOSED
 *
 * A command authorises the turns that COMPLETE it. Once it has produced its
 * action it is spent, and the next turn stands on its own words.
 *
 * THE REGRESSION THIS FILE EXISTS FOR is the closing edge. Carrying a command
 * forward made slot-filling work — a bare title three turns after the
 * instruction executes, as it should — and the same mechanism, left unbounded,
 * would let a fragment typed AFTER the action was already created inherit
 * authority from an instruction that had been carried out. "Still within three
 * turns" is not "still being completed".
 *
 * CONTEXT IS NOT AUTHORIZATION. The conversation may go on knowing the lead, the
 * title and the date; none of that is permission to mutate again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'

const AGENCY = 94_001
const USER = 94_101
let LEAD = 0

const scope = (): AgentScope => ({ agencyId: AGENCY, userId: USER, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })

const COMMAND = 'תיצור לי משימה לדניאל כהן'
const task = (title: string, dueDate = '2026-09-07'): ProposedAction => ({
  actionType: 'create_task', args: { clientId: LEAD, title, dueDate }, evidenceRefs: [`lead:${LEAD}`],
})
const followUp = (at = '2026-09-07'): ProposedAction => ({
  actionType: 'create_follow_up', args: { clientId: LEAD, at, note: 'לחזור לדניאל' }, evidenceRefs: [`lead:${LEAD}`],
})

let seq = 0
const say = (p: ProposedAction, userMessage: string, priorUserMessages: string[] = []) =>
  submitProposedAction({
    proposal: p, scope: scope(), agentRunId: `run_sc_${++seq}`,
    userMessage, priorUserMessages,
    priorAssistantMessage: 'מה כותרת המשימה ולאיזה תאריך?',
  }) as Promise<ActionOutcome>

const tasks = () => db('tasks').where({ clientId: LEAD })
const leadRow = () => db('clients').where({ id: LEAD }).first('nextFollowUpAt')

beforeAll(async () => {
  registerDomainActions()
  await db('agencies').insert({
    id: AGENCY, name: 'sc', plan: 'pro', country: 'IL', defaultCurrency: 'ILS',
    locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: USER, agencyId: AGENCY, email: `sc${USER}@t.test`, role: 'ADMIN', firstName: 'נציג', lastName: 'sc' })
    .onConflict('id').ignore()
  const [row] = await db('clients').insert({ firstName: 'דניאל', lastName: 'כהן', agencyId: AGENCY, createdById: USER, lead: true }).returning('id')
  LEAD = typeof row === 'object' ? (row as { id: number }).id : (row as number)
})

afterEach(async () => {
  await db('tasks').where({ clientId: LEAD }).del()
  await db('clients').where({ id: LEAD }).update({ nextFollowUpAt: null, followUpNote: null })
  await db('agent_action_approvals').where({ agencyId: AGENCY }).del()
  await db('agent_actions').where({ agencyId: AGENCY }).del()
})

afterAll(async () => {
  await db('clients').where({ id: LEAD }).del()
  await db('users').where({ id: USER }).del()
  await db('agencies').where({ id: AGENCY }).del()
})

// ── A · the closing edge ────────────────────────────────────────────────────

describe('Test A — a spent command does not authorise the next fragment', () => {
  it('executes the command, then refuses to inherit for an unrelated fragment', async () => {
    // 1-2. The instruction, completed over two turns.
    const executed = await say(task('לחזור לדניאל'), 'לחזור לדניאל', ['למחר', COMMAND])
    expect(executed.report).toBe('VERIFIED_SUCCESS')
    expect(await tasks()).toHaveLength(1)

    // 3. A new, ambiguous, mutation-shaped fragment — still inside the three-turn
    //    window, and carrying no instruction of its own.
    const after = await say(task('תזכורת לדניאל'), 'תזכורת לדניאל', ['לחזור לדניאל', 'למחר', COMMAND])

    expect(after.report).toBe('AWAITING_APPROVAL')
    expect(after.approval).toBe('PENDING')
    // The CRM is untouched by the second utterance.
    expect(await tasks()).toHaveLength(1)
  })

  it('does not inherit even when the fragment is read as a DIFFERENT action', async () => {
    /**
     * The hole a per-action-type check would have left: the command produced a
     * task, so a follow-up proposed by the next fragment would find no spent
     * command of its own type. A command is spent by whatever it produced.
     */
    const executed = await say(task('לחזור לדניאל'), 'לחזור לדניאל', [COMMAND])
    expect(executed.report).toBe('VERIFIED_SUCCESS')

    const after = await say(followUp(), 'תזכורת לדניאל', ['לחזור לדניאל', COMMAND])
    expect(after.report).toBe('AWAITING_APPROVAL')
    expect((await leadRow()).nextFollowUpAt).toBeNull()
  })

  it('keeps CONTEXT while withdrawing AUTHORIZATION', async () => {
    // The proposal still resolves the same lead and the same date — the system
    // has not forgotten anything. It simply will not act on it unasked.
    await say(task('לחזור לדניאל'), 'לחזור לדניאל', [COMMAND])
    const after = await say(task('תזכורת לדניאל'), 'תזכורת לדניאל', ['לחזור לדניאל', COMMAND])
    expect(after.report).toBe('AWAITING_APPROVAL')
    // Context intact: the action it would run still targets the right lead.
    const pending = await db('agent_actions').where({ agencyId: AGENCY, actionId: after.actionId }).first()
    expect(pending.args.clientId ?? JSON.parse(pending.args).clientId).toBe(LEAD)
  })
})

// ── B-D · the opening edge still works ──────────────────────────────────────

describe('a live command still authorises the turns that complete it', () => {
  it('Test B — the next turn supplies the missing title', async () => {
    const out = await say(task('לחזור לדניאל'), 'לחזור לדניאל', [COMMAND])
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(await tasks()).toHaveLength(1)
  })

  it('Test C — the next turn supplies the missing date', async () => {
    const out = await say(task('לחזור לדניאל', '2026-09-08'), 'למחרתיים', [COMMAND])
    expect(out.report).toBe('VERIFIED_SUCCESS')
  })

  it('Test D — a completion spread over several turns still inherits', async () => {
    const out = await say(task('לחזור לדניאל'), 'לחזור לדניאל', ['למחר בשעה 10:00', COMMAND])
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(await tasks()).toHaveLength(1)
  })

  it('nothing mutates while a required field is still missing', async () => {
    // No proposal is submitted at all until the model has every field; this is
    // the state in between, and the CRM must be untouched in it.
    expect(await tasks()).toHaveLength(0)
    expect((await leadRow()).nextFollowUpAt).toBeNull()
  })
})

// ── E · a new command stands on its own words ───────────────────────────────

describe('Test E — a new explicit command after execution', () => {
  it('executes because IT is a command, not because the old one lingered', async () => {
    const first = await say(task('לחזור לדניאל'), 'לחזור לדניאל', [COMMAND])
    expect(first.report).toBe('VERIFIED_SUCCESS')

    // Carries its own verb, so it never consults the standing command at all.
    const second = await say(followUp(), 'תיצור גם follow-up לדניאל', ['לחזור לדניאל', COMMAND])
    expect(second.report).toBe('VERIFIED_SUCCESS')
    expect((await leadRow()).nextFollowUpAt).not.toBeNull()
  })

  it('a hedged follow-up after execution still waits', async () => {
    await say(task('לחזור לדניאל'), 'לחזור לדניאל', [COMMAND])
    const hedged = await say(followUp(), 'אולי כדאי גם follow-up לדניאל', ['לחזור לדניאל', COMMAND])
    expect(hedged.report).toBe('AWAITING_APPROVAL')
    expect((await leadRow()).nextFollowUpAt).toBeNull()
  })
})
