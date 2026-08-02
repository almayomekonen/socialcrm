import { describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { getAutomationsSendMode } from '@/lib/automations/flags'

// ADR-011 conformance (DI, DB-less): every transition, every reason, the
// claim→effect→confirm→complete order, crash recovery in both modes, and the
// unreachability of the transport in log mode.

const NOW = new Date('2026-08-02T12:00:00Z')

function job(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: 1, agencyId: 7, automationId: 3, leadId: 42,
    trigger: 'lead_created', origin: 'webhook_facebook', eventKey: 'lead_created',
    attempts: 1, maxAttempts: 3, createdAt: NOW.toISOString(),
    ...overrides,
  }
}

function def(overrides: Partial<WorkerDefinition> = {}): WorkerDefinition {
  return {
    id: 3, agencyId: 7, name: 'אימייל פתיחה', recipeKey: 'welcome_new_lead',
    status: 'active', trigger: 'lead_created', targetStatus: null, sourceFilter: null,
    action: 'send_email',
    content: { schemaVersion: 1, subject: 'שלום {{שם הליד}}', body: 'תודה מ{{שם העסק}}', timing: { kind: 'preset', preset: 'immediate' } },
    createdByUserId: 1,
    ...overrides,
  }
}

function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    sendMode: () => 'log',
    reclaim: vi.fn(async () => 0),
    claim: vi.fn(async () => [job()]),
    getDefinition: vi.fn(async () => def()),
    getLeadFacts: vi.fn(async () => ({ exists: true as const, email: 'dana@example.com', currentStatus: 'new', firstName: 'דנה', displayName: 'דנה לוי', handlerId: null })),
    isSuppressed: vi.fn(async () => false),
    isBlocked: vi.fn(async () => false),
    claimState: vi.fn(async () => 'none' as const),
    claimOnce: vi.fn(async () => true),
    confirmClaim: vi.fn(async () => {}),
    releaseClaim: vi.fn(async () => {}),
    hasEffect: vi.fn(async () => false),
    countLeadToday: vi.fn(async () => 0),
    countAgencyToday: vi.fn(async () => 0),
    appendActivity: vi.fn(async () => {}),
    agencyName: vi.fn(async () => 'העסק שלי'),
    repName: vi.fn(async () => null),
    send: vi.fn(async () => ({ ok: true as const, id: 'msg_1' })),
    completeJob: vi.fn(async () => {}),
    skipJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    deadJob: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  }
}

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls

describe('log-mode happy path (the only reachable mode)', () => {
  it('claim → would_send activity → confirm → complete; transport NEVER called', async () => {
    const d = deps()
    const summary = await runAutomationWorker({ deps: d })
    expect(summary).toEqual({ claimed: 1, done: 1, skipped: 0, retried: 0, dead: 0 })
    expect(d.send).not.toHaveBeenCalled()
    const activity = calls(d.appendActivity)[0][0]
    expect(activity).toMatchObject({ kind: 'would_send', mode: 'log', subject: 'שלום דנה', leadName: 'דנה לוי', contentSchemaVersion: 1 })
    // Order: effect before confirm before complete.
    const order = [d.appendActivity, d.confirmClaim, d.completeJob].map((f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  it('default flags resolve to log mode when env is unset', () => {
    delete process.env.AUTOMATIONS_SEND_MODE
    expect(getAutomationsSendMode()).toBe('log')
  })

  it('cap counts are asked since a BUSINESS_TZ day start, not epoch or now', async () => {
    const d = deps()
    await runAutomationWorker({ deps: d })
    const since = calls(d.countLeadToday)[0][2] as Date
    expect(since).toBeInstanceOf(Date)
    expect(since.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(NOW.getTime() - since.getTime()).toBeLessThanOrEqual(24 * 3600_000)
  })
})

describe('law skips are user-visible with explicit reasons', () => {
  it('suppressed lead: skip activity row + job skipped with the law reason', async () => {
    const d = deps({ isSuppressed: vi.fn(async () => true) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'skipped', skipReason: 'suppressed' })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'suppressed')
    expect(d.claimOnce).not.toHaveBeenCalled()
  })

  it('raced claim resolves as already_sent, never as an error', async () => {
    const d = deps({ claimOnce: vi.fn(async () => false) })
    await runAutomationWorker({ deps: d })
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'skipped', skipReason: 'already_sent' })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'already_sent')
  })
})

describe('definition-inert class (job-row only, no user-facing row)', () => {
  it('paused/deleted definition skips quietly (the pause-promise exception)', async () => {
    const d = deps({ getDefinition: vi.fn(async () => def({ status: 'paused' })) })
    await runAutomationWorker({ deps: d })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'definition_inactive')
    expect(d.appendActivity).not.toHaveBeenCalled()
  })

  it('unknown content version is held inert, never guessed', async () => {
    const d = deps({ getDefinition: vi.fn(async () => def({ content: { schemaVersion: 99, subject: 's', body: 'b', timing: { kind: 'preset', preset: 'immediate' } } })) })
    await runAutomationWorker({ deps: d })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'definition_invalid_content')
    expect(d.appendActivity).not.toHaveBeenCalled()
  })
})

describe('retry and death', () => {
  it('transient failure releases the claim and retries; no confirm, no silent loss', async () => {
    const d = deps({ appendActivity: vi.fn(async () => Promise.reject(new Error('db hiccup'))) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.retried).toBe(1)
    expect(d.releaseClaim).toHaveBeenCalledWith(3, 42)
    expect(d.failJob).toHaveBeenCalledWith(1, expect.stringContaining('db hiccup'))
    expect(d.confirmClaim).not.toHaveBeenCalled()
  })

  it('exhausted attempts die with a user-visible failure row', async () => {
    const failing = vi.fn(async (input: unknown) => {
      if ((input as { kind: string }).kind !== 'failed') throw new Error('still broken')
    })
    const d = deps({ claim: vi.fn(async () => [job({ attempts: 3, maxAttempts: 3 })]), appendActivity: failing })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    expect(calls(d.appendActivity).some((c) => (c[0] as { kind: string }).kind === 'failed')).toBe(true)
  })
})

describe('crash recovery (unconfirmed claim from a prior attempt)', () => {
  it('log mode with the effect row present: confirm + complete, NO duplicate row', async () => {
    const d = deps({ claimState: vi.fn(async () => 'claimed' as const), hasEffect: vi.fn(async () => true) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.done).toBe(1)
    expect(d.appendActivity).not.toHaveBeenCalled()
    expect(d.confirmClaim).toHaveBeenCalledWith(3, 42)
    expect(d.completeJob).toHaveBeenCalledWith(1)
  })

  it('log mode without the effect row: writes it exactly once, then confirms', async () => {
    const d = deps({ claimState: vi.fn(async () => 'claimed' as const), hasEffect: vi.fn(async () => false) })
    await runAutomationWorker({ deps: d })
    expect(calls(d.appendActivity)).toHaveLength(1)
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'would_send', mode: 'log' })
    expect(d.confirmClaim).toHaveBeenCalled()
  })

  it('live mode: ambiguous-after-crash dies, is never resent, and is user-visible', async () => {
    const d = deps({ sendMode: () => 'live', claimState: vi.fn(async () => 'claimed' as const) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    expect(d.send).not.toHaveBeenCalled()
    expect(d.deadJob).toHaveBeenCalledWith(1, 'ambiguous_after_crash')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'failed' })
  })
})

describe('live branch is code-complete (and gated off by default)', () => {
  it('with mode live injected: transport called, sent row carries providerMessageId', async () => {
    process.env.AUTOMATIONS_FROM = 'העסק <auto@send.example.com>'
    const d = deps({ sendMode: () => 'live' })
    const summary = await runAutomationWorker({ deps: d })
    delete process.env.AUTOMATIONS_FROM
    expect(summary.done).toBe(1)
    expect(calls(d.send)[0][0]).toMatchObject({ to: 'dana@example.com', subject: 'שלום דנה' })
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'sent', deliveryState: 'sent', providerMessageId: 'msg_1' })
  })
})
