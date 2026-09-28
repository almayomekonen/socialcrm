/**
 * F4 — every internal deadline ends INSIDE the platform's limit.
 *
 * The /api/ai/agent routes export `maxDuration = 60`. A research run was given
 * 90s, so past 60s the platform — not the application — ended it: no final
 * stream event, and an action caught mid-execution left for reconciliation.
 *
 * The invariants below read `maxDuration` straight from the route files, so a
 * deadline cannot be raised past the platform (or the platform lowered under a
 * deadline) without this failing. The behaviour tests pin the two enforcement
 * points: the investigation clock, and the action submitted after it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runAgentInvestigation = vi.hoisted(() => vi.fn())
const submitProposedAction = vi.hoisted(() => vi.fn())
const submitProposedBatch = vi.hoisted(() => vi.fn())
const resolveAgentScope = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent/run', () => ({ runAgentInvestigation }))
vi.mock('@/lib/agent/actions/bridge', () => ({ submitProposedAction, submitProposedBatch }))
vi.mock('@/lib/agent/scope', () => ({ resolveAgentScope }))
vi.mock('@/db/agentInvestigation', () => ({ recordAgentInvestigation: vi.fn() }))

import {
  DEFAULT_DEADLINE_MS,
  FINALIZE_RESERVE_MS,
  REQUEST_DEADLINE_MS,
  ROUTE_MAX_DURATION_MS,
} from '@/lib/agent/budget'
import { RESEARCH_DEADLINE_MS } from '@/lib/agent/research/admission'
import { askAgent } from '@/actions/ai/askAgent'

const routeMaxDurationMs = (rel: string) => {
  const src = readFileSync(join(process.cwd(), rel), 'utf-8')
  const m = src.match(/export const maxDuration = (\d+)/)
  expect(m, `${rel} must export a literal maxDuration`).not.toBeNull()
  return Number(m![1]) * 1000
}

describe('F4 — the deadlines fit the platform', () => {
  it('both agent routes run under the limit the budget is derived from', () => {
    expect(routeMaxDurationMs('app/api/ai/agent/stream/route.ts')).toBe(ROUTE_MAX_DURATION_MS)
    expect(routeMaxDurationMs('app/api/ai/agent/route.ts')).toBe(ROUTE_MAX_DURATION_MS)
  })

  it('all work ends with a reserve left to close the stream', () => {
    expect(FINALIZE_RESERVE_MS).toBeGreaterThanOrEqual(5_000)
    expect(REQUEST_DEADLINE_MS + FINALIZE_RESERVE_MS).toBeLessThanOrEqual(ROUTE_MAX_DURATION_MS)
  })

  it('research and CRM investigations both end before the request deadline, leaving time to act', () => {
    // At least a few seconds between the end of any investigation and the request
    // deadline, so a proposed action can still START inside the request.
    expect(RESEARCH_DEADLINE_MS).toBeLessThanOrEqual(REQUEST_DEADLINE_MS - 5_000)
    expect(DEFAULT_DEADLINE_MS).toBeLessThanOrEqual(REQUEST_DEADLINE_MS - 5_000)
    // The regression itself: research used to outlive the function.
    expect(RESEARCH_DEADLINE_MS).toBeLessThan(ROUTE_MAX_DURATION_MS)
  })
})

describe('F4 — an action is bounded by the REQUEST, not given a fresh clock', () => {
  const SCOPE = { agencyId: 1, userId: 2, role: 'ADMIN', gotPermIds: [], plan: 'pro', firstName: 'א' }
  const proposal = { actionType: 'create_task', args: {}, evidenceRefs: [] }

  beforeEach(() => {
    vi.useRealTimers()
    resolveAgentScope.mockReset().mockResolvedValue(SCOPE)
    submitProposedAction.mockReset().mockResolvedValue({ report: 'AWAITING_APPROVAL' })
    submitProposedBatch.mockReset().mockResolvedValue({ report: 'AWAITING_APPROVAL' })
  })

  it('a slow investigation leaves the action LESS time: its deadline is start + REQUEST_DEADLINE_MS', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-09-28T10:00:00Z').getTime()
    vi.setSystemTime(start)
    // The investigation takes 44s of the request.
    runAgentInvestigation.mockImplementation(async () => {
      vi.setSystemTime(start + 44_000)
      return { ok: true, investigationId: 'inv_1', answer: { proposedAction: proposal, proposedBatch: null } }
    })

    await askAgent('מה המצב?')

    expect(submitProposedAction).toHaveBeenCalledTimes(1)
    const { deadlineAtMs } = submitProposedAction.mock.calls[0]![0] as { deadlineAtMs: number }
    expect(deadlineAtMs).toBe(start + REQUEST_DEADLINE_MS)
    // Not "now + 40s" measured after the investigation, which would end past the route limit.
    expect(deadlineAtMs).toBeLessThan(start + 44_000 + DEFAULT_DEADLINE_MS)
    expect(deadlineAtMs).toBeLessThanOrEqual(start + ROUTE_MAX_DURATION_MS - FINALIZE_RESERVE_MS)
    vi.useRealTimers()
  })

  it('a batch gets the same request-bounded deadline', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-09-28T10:00:00Z').getTime()
    vi.setSystemTime(start)
    runAgentInvestigation.mockResolvedValue({
      ok: true, investigationId: 'inv_2',
      answer: { proposedAction: null, proposedBatch: { actionType: 'create_task', targets: [1], args: {}, evidenceRefs: [] } },
    })

    await askAgent('מה המצב?')

    const { deadlineAtMs } = submitProposedBatch.mock.calls[0]![0] as { deadlineAtMs: number }
    expect(deadlineAtMs).toBe(start + REQUEST_DEADLINE_MS)
    vi.useRealTimers()
  })
})
