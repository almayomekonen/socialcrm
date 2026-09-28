/**
 * F1, end to end: a QUESTION never authorises a write.
 *
 * The unit tests in intent.test.ts pin the classifier. This file pins what the
 * classifier protects: the path from an ordinary question, through a write the
 * model proposed anyway, to the database. For each question the audit
 * reproduced and each action the agent can take, the proposal must stop at
 * AWAITING_APPROVAL and the CRM must be untouched — no task, no meeting, no
 * follow-up, however confident the model was.
 *
 * The control at the bottom is what keeps this honest: the same harness with a
 * real instruction DOES execute, so these pass because the gate works, not
 * because nothing can write.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { submitProposedAction, submitProposedBatch } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction, ProposedBatch } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'

const AGENCY = 94_301
const USER = 94_311
let LEADS: number[] = []

const scope = (): AgentScope => ({ agencyId: AGENCY, userId: USER, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })

/** The four messages the audit executed and saw classified as commands. */
const QUESTIONS = [
  'איזה לידים לא מטופלים בצורה טובה',
  'אילו לידים שקבעתי להם פגישה השבוע?',
  'יש צורך לחזור לדני?',
  'show my open leads',
]

const task = (lead: number): ProposedAction => ({
  actionType: 'create_task', args: { clientId: lead, title: 'לחזור לדני', dueDate: '2026-10-05' }, evidenceRefs: [`lead:${lead}`],
})
const followUp = (lead: number): ProposedAction => ({
  actionType: 'create_follow_up', args: { clientId: lead, at: '2026-10-05', note: 'לחזור לדני' }, evidenceRefs: [`lead:${lead}`],
})
const meeting = (lead: number): ProposedAction => ({
  actionType: 'create_meeting',
  args: { clientId: lead, title: 'פגישת מכירה', date: '2026-10-05', startTime: '10:00', durationMinutes: 45, note: null },
  evidenceRefs: [`lead:${lead}`],
})
const batch = (targets: number[]): ProposedBatch => ({
  actionType: 'create_task', targets, args: { title: 'לחזור', dueDate: '2026-10-05' }, evidenceRefs: targets.map((t) => `lead:${t}`),
})

let seq = 0
const submit = (proposal: ProposedAction, userMessage: string) =>
  submitProposedAction({ proposal, scope: scope(), agentRunId: `run_qnw_${++seq}`, userMessage }) as Promise<ActionOutcome>
const submitBatch = (b: ProposedBatch, userMessage: string) =>
  submitProposedBatch({ batch: b, scope: scope(), agentRunId: `run_qnwb_${++seq}`, userMessage }) as Promise<{ report: string }>

const tasksWritten = () => db('tasks').whereIn('clientId', LEADS)
const meetingsWritten = () => db('meetings').whereIn('lead_id', LEADS)
const followUpsWritten = () => db('clients').whereIn('id', LEADS).whereNotNull('nextFollowUpAt')

beforeAll(async () => {
  registerDomainActions()
  await db('agencies').insert({
    id: AGENCY, name: 'qnw', plan: 'pro', country: 'IL', defaultCurrency: 'ILS',
    locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: USER, agencyId: AGENCY, email: `qnw${USER}@t.test`, role: 'ADMIN', firstName: 'נציג', lastName: 'qnw' })
    .onConflict('id').ignore()
  LEADS = []
  for (const firstName of ['דני', 'דנה', 'יוסי']) {
    const [row] = await db('clients').insert({ firstName, lastName: 'בדיקה', agencyId: AGENCY, createdById: USER, lead: true }).returning('id')
    LEADS.push(typeof row === 'object' ? (row as { id: number }).id : (row as number))
  }
})

afterEach(async () => {
  await db('tasks').whereIn('clientId', LEADS).del()
  await db('meetings').whereIn('lead_id', LEADS).del()
  await db('clients').whereIn('id', LEADS).update({ nextFollowUpAt: null, followUpNote: null })
  await db('agent_action_approvals').where({ agencyId: AGENCY }).del()
  await db('agent_actions').where({ agencyId: AGENCY }).del()
})

afterAll(async () => {
  await db('clients').whereIn('id', LEADS).del()
  await db('users').where({ id: USER }).del()
  await db('agencies').where({ id: AGENCY }).del()
})

describe('F1 — a question plus a model-proposed write still needs approval', () => {
  for (const question of QUESTIONS) {
    describe(question, () => {
      it('create_task waits for approval and writes nothing', async () => {
        const out = await submit(task(LEADS[0]), question)
        expect(out.report).toBe('AWAITING_APPROVAL')
        expect(out.approval).toBe('PENDING')
        expect(await tasksWritten()).toHaveLength(0)
      })

      it('create_follow_up waits for approval and overwrites nothing', async () => {
        const out = await submit(followUp(LEADS[0]), question)
        expect(out.report).toBe('AWAITING_APPROVAL')
        expect(await followUpsWritten()).toHaveLength(0)
      })

      it('create_meeting waits for approval and books nothing', async () => {
        const out = await submit(meeting(LEADS[0]), question)
        expect(out.report).toBe('AWAITING_APPROVAL')
        expect(await meetingsWritten()).toHaveLength(0)
      })

      it('a batch waits for approval and creates no task', async () => {
        const out = await submitBatch(batch(LEADS), question)
        expect(out.report).toBe('AWAITING_APPROVAL')
        expect(await tasksWritten()).toHaveLength(0)
      })
    })
  }
})

describe('control — the same harness with a real instruction does execute', () => {
  it('an explicit command still writes without a card', async () => {
    const out = await submit(task(LEADS[0]), 'צור משימה לחזור לדני')
    expect(out.report).toBe('VERIFIED_SUCCESS')
    expect(await tasksWritten()).toHaveLength(1)
  })
})
