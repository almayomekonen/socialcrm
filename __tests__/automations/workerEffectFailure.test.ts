import { describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDeps } from '@/lib/automations/workerDeps'
import { ExecutionOutcomeUnknownError, ExecutionSkippedError } from '@/lib/automations/executors/types'
import { settleEffectFailure } from '@/lib/automations/workerEffectFailure'

/**
 * settleEffectFailure is the worker's post-claim failure path, extracted from
 * worker.ts. Its order is law: release the claim first, then end the job.
 */

const job = (over: Partial<AutomationJob> = {}): AutomationJob => ({
  id: 3,
  agencyId: 7,
  automationId: 42,
  leadId: 9,
  trigger: 'lead_created',
  origin: 'manual',
  eventKey: 'k',
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date().toISOString(),
  ...over,
})

function harness() {
  const calls: string[] = []
  const rec = (name: string) => vi.fn(async () => void calls.push(name))
  const deps = {
    releaseClaim: rec('releaseClaim'),
    appendActivity: rec('appendActivity'),
    skipJob: rec('skipJob'),
    deadJob: rec('deadJob'),
    failJob: rec('failJob'),
  } as unknown as WorkerDeps
  return { deps, calls, log: vi.fn() }
}

const terminalAccountError = () =>
  Object.assign(new Error('account'), { name: 'TerminalWhatsappAccountError', terminal: true, category: 'account' })

describe('settleEffectFailure', () => {
  it('a late law refusal is a final skip: claim released, skipped activity, never failed or dead', async () => {
    const h = harness()
    const out = await settleEffectFailure({
      job: job(),
      err: new ExecutionSkippedError('opted_out'),
      mode: 'live',
      leadName: 'ליד',
      deps: h.deps,
      log: h.log,
    })
    expect(out).toBe('skipped')
    expect(h.calls).toEqual(['releaseClaim', 'appendActivity', 'skipJob'])
    expect(h.deps.releaseClaim).toHaveBeenCalledWith(42, 9)
    expect(h.deps.appendActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'skipped', skipReason: 'opted_out', mode: 'live', leadName: 'ליד' }),
    )
    expect(h.deps.skipJob).toHaveBeenCalledWith(3, 'opted_out')
  })

  it('an UNKNOWN send outcome keeps the claim and is dead: never retried, never re-claimable', async () => {
    const h = harness()
    const out = await settleEffectFailure({
      job: job({ attempts: 1 }),
      err: new ExecutionOutcomeUnknownError('whatsapp: send-timeout'),
      mode: 'live',
      leadName: null,
      deps: h.deps,
      log: h.log,
    })
    expect(out).toBe('dead')
    // No releaseClaim, no failJob: the unconfirmed claim stays, exactly as after a crash (ADR-011).
    expect(h.calls).toEqual(['deadJob', 'appendActivity'])
    expect(h.deps.deadJob).toHaveBeenCalledWith(3, 'send_outcome_unknown')
    expect(h.deps.appendActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'failed' }))
    expect(h.log).toHaveBeenCalledWith('dead', expect.anything(), expect.objectContaining({ class: 'ambiguous' }))
  })

  it('a terminal account error is dead at once, dead recorded before the failed activity', async () => {
    const h = harness()
    const out = await settleEffectFailure({ job: job(), err: terminalAccountError(), mode: 'live', leadName: null, deps: h.deps, log: h.log })
    expect(out).toBe('dead')
    expect(h.calls).toEqual(['releaseClaim', 'deadJob', 'appendActivity'])
    expect(h.deps.appendActivity).toHaveBeenCalledWith(expect.not.objectContaining({ skipReason: expect.anything() }))
  })

  it('a transient error is retried while attempts remain, with no activity row', async () => {
    const h = harness()
    const out = await settleEffectFailure({ job: job({ attempts: 1 }), err: new Error('net'), mode: 'live', leadName: null, deps: h.deps, log: h.log })
    expect(out).toBe('retried')
    expect(h.calls).toEqual(['releaseClaim', 'failJob'])
  })

  it('a transient error on the last attempt is dead with a failed activity', async () => {
    const h = harness()
    const out = await settleEffectFailure({ job: job({ attempts: 3 }), err: new Error('net'), mode: 'live', leadName: null, deps: h.deps, log: h.log })
    expect(out).toBe('dead')
    expect(h.calls).toEqual(['releaseClaim', 'failJob', 'appendActivity'])
    expect(h.deps.appendActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'failed' }))
  })
})
