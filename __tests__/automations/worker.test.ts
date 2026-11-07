import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { TerminalWhatsappAccountError } from '@/lib/inbox/onWhatsappSendFailure'
import { ExecutionSkippedError } from '@/lib/automations/executors/types'
import { getAutomationsSendMode } from '@/lib/automations/flags'
import { getAction } from '@/lib/automations/catalog/registry'
import { emailExecutor } from '@/lib/automations/executors/email'
import { MISSING_MEETING } from '@/lib/automations/appointments'

// ADR-011 conformance (DI, DB-less): every transition, every reason, the
// claim→effect→confirm→complete order, crash recovery in both modes, and the
// unreachability of the transport in log mode.

const NOW = new Date('2026-08-02T12:00:00Z')

function job(overrides: Partial<AutomationJob> = {}): AutomationJob {
  return {
    id: 1,
    agencyId: 7,
    automationId: 3,
    leadId: 42,
    trigger: 'lead_created',
    origin: 'webhook_facebook',
    eventKey: 'lead_created',
    attempts: 1,
    maxAttempts: 3,
    createdAt: NOW.toISOString(),
    ...overrides,
  }
}

function def(overrides: Partial<WorkerDefinition> = {}): WorkerDefinition {
  return {
    id: 3,
    agencyId: 7,
    name: 'אימייל פתיחה',
    recipeKey: 'welcome_new_lead',
    status: 'active',
    trigger: 'lead_created',
    action: 'send_email',
    content: {
      schemaVersion: 1,
      subject: 'שלום {{שם הליד}}',
      body: 'תודה מ{{שם העסק}}',
      timing: { kind: 'preset', preset: 'immediate' },
    },
    createdByUserId: 1,
    conditions: [],
    // Faithful to what the store actually writes: `actions[0].parameters` is
    // always the content document's projection (createDefinition and
    // updateDefinitionContent write both together; the B3 migration backfilled
    // existing rows; normalise() synthesises for anything older). B5 executes
    // from here, so a fixture that diverged would test a state that cannot exist.
    actions: [{ actionKey: 'email.send', parameters: { subject: 'שלום {{שם הליד}}', body: 'תודה מ{{שם העסק}}' } }],
    connectionId: null,
    sourceIds: [],
    ...overrides,
  }
}

/**
 * B6b: the email executor now resolves its OWN dependencies, so a DB-less test
 * stubs them here rather than on the worker. `transport` is the shared spy —
 * that it lives on the executor, not on WorkerDeps, is the point.
 */
const transport = vi.fn(async () => ({ ok: true as const, id: 'msg_1' }))
let executorDeps: Record<string, unknown> = {}

beforeEach(() => {
  transport.mockClear()
  executorDeps = {}
})

const stubbedEmailExecutor = () =>
  ({
    ...emailExecutor,
    defaultDeps: () => ({
      agencyName: async () => 'העסק שלי',
      replyTo: async () => 'owner@business.example',
      repName: async () => null,
      from: () => '',
      send: transport,
      ...executorDeps,
    }),
  }) as never

function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    sendMode: () => 'log',
    reclaim: vi.fn(async () => 0),
    claim: vi.fn(async () => [job()]),
    getDefinition: vi.fn(async () => def()),
    getLeadFacts: vi.fn(async () => ({
      exists: true as const,
      email: 'dana@example.com',
      phone: null,
      currentStatus: 'new',
      firstName: 'דנה',
      displayName: 'דנה לוי',
      handlerId: null,
    })),
    isSuppressed: vi.fn(async () => false),
    isOptedOut: vi.fn(async () => false),
    isRecipientBlocked: vi.fn(async () => false),
    claimState: vi.fn(async () => 'none' as const),
    claimOnce: vi.fn(async () => true),
    confirmClaim: vi.fn(async () => {}),
    releaseClaim: vi.fn(async () => {}),
    hasEffect: vi.fn(async () => false),
    countLeadToday: vi.fn(async () => 0),
    countAutoResponsesToday: vi.fn(async () => 0),
    countAgencyToday: vi.fn(async () => 0),
    appendActivity: vi.fn(async () => {}),
    agencyName: vi.fn(async () => 'העסק שלי'),
    repName: vi.fn(async () => null),
    // Appointment jobs read the occurrence's meeting; other triggers never do.
    meetingFacts: vi.fn(async () => MISSING_MEETING),
    getAction: vi.fn(getAction),
    executorFor: vi.fn(stubbedEmailExecutor) as never,
    completeJob: vi.fn(async () => {}),
    skipJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    deadJob: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  }
}

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls

/**
 * B6b: the transport is one of the EMAIL EXECUTOR's own dependencies — the
 * worker no longer declares it. A test that wants to watch the transport
 * therefore overrides the executor's deps, which is itself the proof that the
 * worker supplies nothing channel-specific.
 */
/** Same worker deps, plus executor-dep overrides and the transport spy. */
function withTransport(over: Partial<WorkerDeps> = {}, over2: Record<string, unknown> = {}) {
  executorDeps = over2
  return { d: deps(over), transport }
}

describe('log-mode happy path (the only reachable mode)', () => {
  it('claim → would_send activity → confirm → complete; transport NEVER called', async () => {
    const { d, transport } = withTransport()
    const summary = await runAutomationWorker({ deps: d })
    expect(summary).toEqual({ claimed: 1, done: 1, skipped: 0, retried: 0, dead: 0 })
    expect(transport).not.toHaveBeenCalled()
    const activity = calls(d.appendActivity)[0][0]
    expect(activity).toMatchObject({
      kind: 'would_send',
      mode: 'log',
      subject: 'שלום דנה',
      leadName: 'דנה לוי',
      contentSchemaVersion: 1,
    })
    // Order: effect before confirm before complete.
    const order = [d.appendActivity, d.confirmClaim, d.completeJob].map(
      (f) => (f as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    )
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
    const d = deps({
      getDefinition: vi.fn(async () =>
        def({ content: { schemaVersion: 99, subject: 's', body: 'b', timing: { kind: 'preset', preset: 'immediate' } } }),
      ),
    })
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
    const { d, transport } = withTransport({ sendMode: () => 'live', claimState: vi.fn(async () => 'claimed' as const) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    expect(transport).not.toHaveBeenCalled()
    expect(d.deadJob).toHaveBeenCalledWith(1, 'ambiguous_after_crash')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'failed' })
  })
})

describe('live branch is code-complete (and gated off by default)', () => {
  it('with mode live injected: transport called with the resolved identity', async () => {
    const { d, transport } = withTransport({ sendMode: () => 'live' }, { from: () => 'auto@send.example.com' })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.done).toBe(1)
    expect(calls(transport)[0][0]).toMatchObject({
      to: 'dana@example.com',
      subject: 'שלום דנה',
      from: '"העסק שלי" <auto@send.example.com>', // display name = business name
      replyTo: 'owner@business.example', // replies reach the owner's real inbox
    })
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'sent', deliveryState: 'sent', providerMessageId: 'msg_1' })
  })
})

describe('identity gate (ADR-013) — now entirely the executor’s preflight', () => {
  it('live mode with no sending domain dies WITHOUT consuming the once-ever claim', async () => {
    const { d, transport } = withTransport({ sendMode: () => 'live' }, { from: () => '' })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    // The claim must survive: once configured, the lead still gets this email.
    expect(d.claimOnce).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
    expect(d.failJob).not.toHaveBeenCalled() // definitive, never a retry storm
    expect(d.deadJob).toHaveBeenCalledWith(1, 'identity_unavailable:no_sending_domain')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'failed' })
  })

  it('live mode with no resolvable reply-to is treated the same way', async () => {
    const { d } = withTransport({ sendMode: () => 'live' }, { from: () => 'auto@send.example.com', replyTo: async () => null })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    expect(d.deadJob).toHaveBeenCalledWith(1, 'identity_unavailable:no_reply_to')
    expect(d.claimOnce).not.toHaveBeenCalled()
  })

  it('log mode is never blocked by incomplete identity — the preview still renders', async () => {
    const { d } = withTransport({}, { from: () => '', replyTo: async () => null })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.done).toBe(1)
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'would_send', subject: 'שלום דנה' })
  })
})

/**
 * B6 — the premise, evaluated from catalog metadata instead of a status column.
 *
 * These assertions are the end-to-end form of what `expectedStatus` used to
 * do. The definition now carries an ordinary LIVE condition; the worker
 * resolves its value from the lead and the engine skips with the same reason,
 * writes the same activity row, and never sends.
 */
describe('the live premise (B6)', () => {
  const statusAutomation = (expected: string) =>
    def({
      trigger: 'status_changed',
      conditions: [{ field: 'status', operator: 'is', value: expected }],
    })

  const leadWithStatus = (currentStatus: string) => ({
    exists: true as const,
    email: 'dana@example.com',
    phone: null,
    currentStatus,
    firstName: 'דנה',
    displayName: 'דנה לוי',
    handlerId: null,
  })

  it('holds when the lead is still in the premised status', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () => statusAutomation('contacted')),
      getLeadFacts: vi.fn(async () => leadWithStatus('contacted')),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary).toEqual({ claimed: 1, done: 1, skipped: 0, retried: 0, dead: 0 })
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'would_send' })
  })

  it('expires when the lead moved on — same reason, same activity row as before B6', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () => statusAutomation('contacted')),
      getLeadFacts: vi.fn(async () => leadWithStatus('interested')),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary).toEqual({ claimed: 1, done: 0, skipped: 1, retried: 0, dead: 0 })
    expect(calls(d.skipJob)[0][1]).toBe('premise_expired')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'skipped', skipReason: 'premise_expired' })
    // The claim is never taken for a job whose premise failed.
    expect(d.claimOnce).not.toHaveBeenCalled()
  })

  it('an automation with no conditions has nothing to expire', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () => def({ trigger: 'status_changed', conditions: [] })),
      getLeadFacts: vi.fn(async () => leadWithStatus('lost')),
    })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
  })

  it('a SNAPSHOT condition is not re-evaluated at execution — emission already settled it', async () => {
    // `source` is snapshot; the worker has no event payload and must not
    // invent one. Re-evaluating here would fail closed and lose a real send.
    const d = deps({
      getDefinition: vi.fn(async () => def({ conditions: [{ field: 'source', operator: 'contains', value: 'facebook' }] })),
    })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
  })

  it('resolves each subject field AT MOST ONCE, however many consumers want it', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () => statusAutomation('contacted')),
      getLeadFacts: vi.fn(async () => leadWithStatus('contacted')),
    })
    await runAutomationWorker({ deps: d })
    // `businessName` is wanted by the executor's declared variables and NOT by
    // this status premise — one fetch, not one per consumer.
    expect(calls(d.agencyName).length).toBe(1)
  })

  it('a premise on a field the worker must fetch resolves it, once', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () =>
        def({ trigger: 'status_changed', conditions: [{ field: 'businessName', operator: 'is', value: 'העסק שלי' }] }),
      ),
      getLeadFacts: vi.fn(async () => leadWithStatus('contacted')),
    })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
    // Wanted by BOTH the premise and the executor's variables — still one fetch.
    expect(calls(d.agencyName).length).toBe(1)
  })

  it('an unknown condition field fails CLOSED rather than sending unguarded', async () => {
    const d = deps({
      claim: vi.fn(async () => [job({ trigger: 'status_changed' })]),
      getDefinition: vi.fn(async () =>
        def({ trigger: 'status_changed', conditions: [{ field: 'nonsense', operator: 'is', value: 'x' } as never] }),
      ),
      getLeadFacts: vi.fn(async () => leadWithStatus('contacted')),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(calls(d.skipJob)[0][1]).toBe('premise_expired')
    // Nothing was executed at all: the executor is never reached.
    expect(d.claimOnce).not.toHaveBeenCalled()
  })
})

describe('whatsapp account restriction is terminal', () => {
  it('dead-letters immediately — no failJob retry', async () => {
    const executor = {
      actionKey: 'whatsapp.send',
      resolvableFields: [],
      defaultDeps: () => ({}),
      preflight: async () => ({ ready: {}, problem: null }),
      execute: async () => {
        throw new TerminalWhatsappAccountError('whatsapp: 131031 restricted')
      },
    }
    const d = deps({
      sendMode: () => 'live',
      getDefinition: vi.fn(async () =>
        def({
          action: 'send_whatsapp',
          actions: [{ actionKey: 'whatsapp.send', parameters: { templateId: 5 } }],
        }),
      ),
      getAction: vi.fn(() => getAction('whatsapp.send')),
      executorFor: vi.fn(() => executor) as never,
      getLeadFacts: vi.fn(async () => ({
        exists: true as const,
        email: null,
        phone: '972501234567',
        currentStatus: 'new',
        firstName: 'דנה',
        displayName: 'דנה לוי',
        handlerId: null,
      })),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.dead).toBe(1)
    expect(summary.retried).toBe(0)
    expect(d.deadJob).toHaveBeenCalledWith(1, expect.stringContaining('131031'))
    expect(d.failJob).not.toHaveBeenCalled()
    expect(d.confirmClaim).not.toHaveBeenCalled()
    expect(d.releaseClaim).toHaveBeenCalledWith(3, 42)
    expect(calls(d.appendActivity).some((c) => (c[0] as { kind: string }).kind === 'failed')).toBe(true)
  })
})

describe('an effect refused at the last moment (opt-out gate) is a terminal skip', () => {
  it('skips with opted_out — no retry, no dead letter, no failure, claim released', async () => {
    const executor = {
      actionKey: 'whatsapp.send',
      resolvableFields: [],
      defaultDeps: () => ({}),
      preflight: async () => ({ ready: {}, problem: null }),
      execute: async () => {
        throw new ExecutionSkippedError('opted_out')
      },
    }
    const d = deps({
      sendMode: () => 'live',
      getDefinition: vi.fn(async () =>
        def({ action: 'send_whatsapp', actions: [{ actionKey: 'whatsapp.send', parameters: { templateId: 5 } }] }),
      ),
      getAction: vi.fn(() => getAction('whatsapp.send')),
      executorFor: vi.fn(() => executor) as never,
      getLeadFacts: vi.fn(async () => ({
        exists: true as const,
        email: null,
        phone: '972501234567',
        currentStatus: 'new',
        firstName: 'דנה',
        displayName: 'דנה לוי',
        handlerId: null,
      })),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary).toMatchObject({ skipped: 1, retried: 0, dead: 0, done: 0 })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'opted_out')
    expect(d.failJob).not.toHaveBeenCalled()
    expect(d.deadJob).not.toHaveBeenCalled()
    expect(d.confirmClaim).not.toHaveBeenCalled()
    expect(d.releaseClaim).toHaveBeenCalledWith(3, 42)
    expect(calls(d.appendActivity).some((c) => (c[0] as { kind: string; skipReason?: string }).skipReason === 'opted_out')).toBe(true)
  })
})
