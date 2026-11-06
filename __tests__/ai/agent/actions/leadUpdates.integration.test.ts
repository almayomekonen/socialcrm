/**
 * `update_lead_status` and `add_lead_note` through the REAL bridge and runtime,
 * against Postgres: proposal → AWAITING_APPROVAL → decision → executor (the
 * session-less system writers) → verifier re-reading the row → audit.
 *
 * What must hold: always a card; permissions and the lead's CURRENT state are
 * checked at execution, not at proposal; a second approval writes nothing
 * twice; a stale card writes nothing; another agency's lead is untouchable;
 * history and existing notes are preserved.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { enableAgentFor, restoreAgentRollout } from './_agentRollout'

vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import { registerDomainActions } from '@/lib/agent/actions/domain'
import { Roles } from '@/types/roles'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'

const AGENCY_A = 94_001
const AGENCY_B = 94_002
const ADMIN_A = 94_101
const ADMIN_B = 94_102
const REP_A = 94_103
let LEAD_A = 0
let LEAD_B = 0
let LEAD_OWNED = 0

const adminA = (): AgentScope => ({ agencyId: AGENCY_A, userId: ADMIN_A, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'א' })
const adminB = (): AgentScope => ({ agencyId: AGENCY_B, userId: ADMIN_B, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'ב' })
const rep = (gotPermIds: number[]): AgentScope => ({ agencyId: AGENCY_A, userId: REP_A, role: Roles.AGNT, gotPermIds, plan: 'pro', firstName: 'נ' })

const statusProposal = (clientId: number, status: string, fromStatus: string | null): ProposedAction => ({
  actionType: 'update_lead_status',
  args: { clientId, status, fromStatus },
  evidenceRefs: [`lead:${clientId}`],
})
const noteProposal = (clientId: number, content: string): ProposedAction => ({
  actionType: 'add_lead_note',
  args: { clientId, content },
  evidenceRefs: [`lead:${clientId}`],
})

let seq = 0
/** The WhatsApp path submits WITHOUT the owner's words. */
const submit = (p: ProposedAction, scope: AgentScope, userMessage?: string) =>
  submitProposedAction({ proposal: p, scope, agentRunId: `run_lu_${++seq}`, userMessage })

async function approve(o: ActionOutcome | null, scope: AgentScope) {
  expect(o?.report).toBe('AWAITING_APPROVAL')
  return decideOnAction({ actionId: o!.actionId, argsHash: o!.argsHash, decision: 'APPROVED', scope, nowMs: Date.now() })
}

async function seedAgency(agencyId: number, adminId: number): Promise<number> {
  await db('agencies').insert({
    id: agencyId, name: `lu-${agencyId}`, plan: 'pro', country: 'IL',
    defaultCurrency: 'ILS', locale: 'he', docNumberFormat: '{n}', bankDetails: '{}',
  } as never).onConflict('id').ignore()
  await db('users').insert({ id: adminId, agencyId, email: `l${adminId}@t.test`, role: 'ADMIN', firstName: 'מנהל', lastName: String(adminId) })
    .onConflict('id').ignore()
  const [row] = await db('clients').insert({ firstName: 'אבי', lastName: String(agencyId), agencyId, createdById: adminId, status: 'new' }).returning('id')
  return typeof row === 'object' ? (row as { id: number }).id : (row as number)
}

beforeAll(async () => {
  enableAgentFor([AGENCY_A, AGENCY_B])
  registerDomainActions()
  LEAD_A = await seedAgency(AGENCY_A, ADMIN_A)
  LEAD_B = await seedAgency(AGENCY_B, ADMIN_B)
  await db('users').insert({ id: REP_A, agencyId: AGENCY_A, email: `l${REP_A}@t.test`, role: 'AGNT', firstName: 'נציג', lastName: 'א' })
    .onConflict('id').ignore()
  const [owned] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'שלי', agencyId: AGENCY_A, createdById: ADMIN_A, userId: REP_A, status: 'new' })
    .returning('id')
  LEAD_OWNED = typeof owned === 'object' ? (owned as { id: number }).id : (owned as number)
})

const ALL = () => [LEAD_A, LEAD_B, LEAD_OWNED]
afterEach(async () => {
  await db('clients').whereIn('id', ALL()).update({ status: 'new' })
  await db('lead_status_transitions').whereIn('leadId', ALL()).del()
  await db('lead_notes').whereIn('leadId', ALL()).del()
  await db('agent_action_approvals').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
  await db('agent_actions').whereIn('agencyId', [AGENCY_A, AGENCY_B]).del()
})

afterAll(async () => {
  restoreAgentRollout()
  // Agencies and users stay: the status change emits analytics rows that reference
  // them, and the test database is rebuilt per run anyway.
  await db('clients').whereIn('id', ALL()).del()
  await db.destroy()
})

const statusOf = async (id: number) => ((await db('clients').where({ id }).first('status')) as { status: string }).status

describe('update_lead_status', () => {
  it('always waits for a card, even when the owner commanded it in words', async () => {
    const o = await submit(statusProposal(LEAD_A, 'closed', 'new'), adminA(), 'תעביר את אבי לסגור')
    expect(o?.report).toBe('AWAITING_APPROVAL')
    expect(await statusOf(LEAD_A)).toBe('new')
  })

  it('approved: the status changes, verified against the row, with history like a manual change', async () => {
    const d = await approve(await submit(statusProposal(LEAD_A, 'closed', 'new'), adminA()), adminA())
    expect(d.ok && d.outcome.report).toBe('VERIFIED_SUCCESS')
    const row = await db('clients').where({ id: LEAD_A }).first('status', 'statusChangedAt', 'lastActivityAt')
    expect(row.status).toBe('closed')
    expect(row.statusChangedAt).not.toBeNull()
    const history = await db('lead_status_transitions').where({ leadId: LEAD_A }).select('fromStatus', 'toStatus', 'source', 'actorUserId')
    expect(history).toEqual([{ fromStatus: 'new', toStatus: 'closed', source: 'manual', actorUserId: ADMIN_A }])
  })

  it('a second approval of the same card writes nothing twice', async () => {
    const o = await submit(statusProposal(LEAD_A, 'contacted', 'new'), adminA())
    await approve(o, adminA())
    const again = await decideOnAction({ actionId: o!.actionId, argsHash: o!.argsHash, decision: 'APPROVED', scope: adminA(), nowMs: Date.now() })
    if (again.ok) expect(['DUPLICATE_NOOP', 'VERIFIED_SUCCESS']).toContain(again.outcome.report)
    expect(await db('lead_status_transitions').where({ leadId: LEAD_A }).count<{ count: string }[]>('* as count')).toEqual([{ count: '1' }])
  })

  it('a stale card writes nothing: the lead changed after the card was shown', async () => {
    const o = await submit(statusProposal(LEAD_A, 'closed', 'new'), adminA())
    await db('clients').where({ id: LEAD_A }).update({ status: 'interested' }) // a colleague, meanwhile
    const d = await approve(o, adminA())
    expect(d.ok && d.outcome.execution?.reason).toBe('status-changed-since-proposal')
    expect(await statusOf(LEAD_A)).toBe('interested')
    expect(await db('lead_status_transitions').where({ leadId: LEAD_A })).toHaveLength(0)
  })

  it('permissions are re-checked at execution: a rep loses access between card and tap', async () => {
    const o = await submit(statusProposal(LEAD_OWNED, 'contacted', 'new'), rep([REP_A]))
    const d = await approve(o, rep([]))
    expect(d.ok && d.outcome.report).not.toBe('VERIFIED_SUCCESS')
    expect(await statusOf(LEAD_OWNED)).toBe('new')
  })

  it("a rep may change their own lead, never a colleague's", async () => {
    const own = await approve(await submit(statusProposal(LEAD_OWNED, 'contacted', 'new'), rep([REP_A])), rep([REP_A]))
    expect(own.ok && own.outcome.report).toBe('VERIFIED_SUCCESS')
    const other = await approve(await submit(statusProposal(LEAD_A, 'contacted', 'new'), rep([REP_A])), rep([REP_A]))
    expect(other.ok && other.outcome.execution?.status).toBe('NOT_AUTHORIZED')
    expect(await statusOf(LEAD_A)).toBe('new')
  })

  it("another agency's lead is untouchable", async () => {
    const d = await approve(await submit(statusProposal(LEAD_A, 'lost', 'new'), adminB()), adminB())
    expect(d.ok && d.outcome.report).not.toBe('VERIFIED_SUCCESS')
    expect(await statusOf(LEAD_A)).toBe('new')
  })

  it('only the five SocialCRM statuses can be written, even if a card for another were approved', async () => {
    // The WhatsApp layer never shows a card for one (leadUpdates propose test);
    // this is the executor's own guard beneath it.
    const d = await approve(await submit(statusProposal(LEAD_A, 'won', 'new'), adminA()), adminA())
    expect(d.ok && d.outcome.execution?.status).toBe('INVALID_ACTION')
    expect(await statusOf(LEAD_A)).toBe('new')
  })
})

describe('add_lead_note', () => {
  it('approved: a new lead_notes row by the acting user; existing notes are preserved', async () => {
    await db('lead_notes').insert({ agencyId: AGENCY_A, leadId: LEAD_A, userId: ADMIN_A, userName: 'קודם', content: 'הערה קיימת' })
    const d = await approve(await submit(noteProposal(LEAD_A, 'רוצה לדבר שבוע הבא'), adminA()), adminA())
    expect(d.ok && d.outcome.report).toBe('VERIFIED_SUCCESS')
    const notes = await db('lead_notes').where({ leadId: LEAD_A }).orderBy('id').select('content', 'userId', 'userName', 'agencyId')
    expect(notes).toEqual([
      { content: 'הערה קיימת', userId: ADMIN_A, userName: 'קודם', agencyId: AGENCY_A },
      { content: 'רוצה לדבר שבוע הבא', userId: ADMIN_A, userName: `מנהל ${ADMIN_A}`, agencyId: AGENCY_A },
    ])
  })

  it('a second approval of the same card adds no second note', async () => {
    const o = await submit(noteProposal(LEAD_A, 'פעם אחת בלבד'), adminA())
    await approve(o, adminA())
    await decideOnAction({ actionId: o!.actionId, argsHash: o!.argsHash, decision: 'APPROVED', scope: adminA(), nowMs: Date.now() })
    expect(await db('lead_notes').where({ leadId: LEAD_A, content: 'פעם אחת בלבד' })).toHaveLength(1)
  })

  it("a rep cannot note a colleague's lead; another agency cannot note at all", async () => {
    const r = await approve(await submit(noteProposal(LEAD_A, 'לא שלי'), rep([REP_A])), rep([REP_A]))
    expect(r.ok && r.outcome.execution?.status).toBe('NOT_AUTHORIZED')
    const b = await approve(await submit(noteProposal(LEAD_A, 'מסוכנות אחרת'), adminB()), adminB())
    expect(b.ok && b.outcome.report).not.toBe('VERIFIED_SUCCESS')
    expect(await db('lead_notes').where({ leadId: LEAD_A })).toHaveLength(0)
  })

  it('rejecting the card writes nothing', async () => {
    const o = await submit(noteProposal(LEAD_A, 'בוטל'), adminA())
    await decideOnAction({ actionId: o!.actionId, argsHash: o!.argsHash, decision: 'REJECTED', scope: adminA(), nowMs: Date.now() })
    expect(await db('lead_notes').where({ leadId: LEAD_A })).toHaveLength(0)
  })
})
