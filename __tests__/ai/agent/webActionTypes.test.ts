/**
 * WhatsApp-only action types never reach the web Agent: not its Action Runtime
 * call and not its answer (the web action card has no rendering for them).
 * Both web routes go through askAgent, so this is the one place to pin it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runAgentInvestigation = vi.hoisted(() => vi.fn())
const submitProposedAction = vi.hoisted(() => vi.fn())
const submitProposedBatch = vi.hoisted(() => vi.fn())
const resolveAgentScope = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/run', () => ({ runAgentInvestigation }))
vi.mock('@/lib/agent/actions/bridge', () => ({ submitProposedAction, submitProposedBatch }))
vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/db/agentInvestigation', () => ({ recordAgentInvestigation: vi.fn() }))

import { askAgent } from '@/actions/ai/askAgent'

const SCOPE = { agencyId: 1, userId: 2, role: 'ADMIN', gotPermIds: [], plan: 'pro', firstName: 'א' }
const answerWith = (proposedAction: unknown) => ({ ok: true, investigationId: 'inv_1', answer: { headline: 'h', claims: [], proposedAction, proposedBatch: null } })

beforeEach(() => {
  resolveAgentScope.mockReset().mockResolvedValue(SCOPE)
  submitProposedAction.mockReset().mockResolvedValue({ report: 'AWAITING_APPROVAL' })
  submitProposedBatch.mockReset()
})

describe('web Agent and WhatsApp-only actions', () => {
  it.each([
    { actionType: 'update_lead_status', args: { clientId: 5, status: 'closed' }, evidenceRefs: ['lead:5'] },
    { actionType: 'add_lead_note', args: { clientId: 5, content: 'x' }, evidenceRefs: ['lead:5'] },
    { actionType: 'create_quote', args: { clientId: 5, title: 't', lines: [], priceBasis: null, validityDays: null }, evidenceRefs: ['lead:5'] },
  ])('$actionType is dropped: never submitted, never in the answer', async (proposal) => {
    runAgentInvestigation.mockResolvedValue(answerWith(proposal))
    const r = (await askAgent('תעביר את אבי לסגור')) as { answer: { proposedAction: unknown }; actionOutcome: unknown }
    expect(submitProposedAction).not.toHaveBeenCalled()
    expect(r.answer.proposedAction).toBeNull()
    expect(r.actionOutcome).toBeNull()
  })

  it('the web actions are unchanged', async () => {
    const task = { actionType: 'create_task', args: { clientId: 5, title: 't', dueDate: '2026-11-10' }, evidenceRefs: ['lead:5'] }
    runAgentInvestigation.mockResolvedValue(answerWith(task))
    await askAgent('תיצור משימה לאבי')
    expect(submitProposedAction).toHaveBeenCalledTimes(1)
  })
})
