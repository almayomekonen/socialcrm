import { describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { executorFor, registeredActionKeys } from '@/lib/automations/executors/registry'
import { catalog } from '@/lib/automations/catalog/registry'
import { getAction } from '@/lib/automations/catalog/registry'
import type { ActionDefinition } from '@/lib/automations/catalog/types'
import type { ActionExecutor } from '@/lib/automations/executors/types'
import { actionKeyFor, actionParameters, actionsForContent } from '@/lib/automations/actionEntry'

/**
 * B5 PROOF: the engine executes ACTIONS, not emails.
 *
 * The centrepiece is an entirely invented action — `note.write` — with no
 * recipient requirement, its own law set, and an executor that touches no
 * transport. It runs end to end through the shipped worker. Nothing in the
 * worker was changed to accommodate it, which is the claim under test.
 */

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

const CONTENT = { subject: 'נושא', body: 'תוכן' }

function def(overrides: Partial<WorkerDefinition> = {}): WorkerDefinition {
  return {
    id: 3,
    agencyId: 7,
    name: 'משימה לנציג',
    recipeKey: null,
    status: 'active',
    trigger: 'lead_created',
    targetStatus: null,
    sourceFilter: null,
    action: 'send_email',
    content: { schemaVersion: 1, ...CONTENT, timing: { kind: 'preset', preset: 'immediate' } },
    createdByUserId: 1,
    conditions: [],
    actions: actionsForContent('note.write', CONTENT),
    connectionId: null,
    sourceIds: [],
    ...overrides,
  } as WorkerDefinition
}

/** An action with NO recipient requirement and only the send-once law. */
const NOTE_WRITE: ActionDefinition = {
  key: 'note.write',
  title: 'רישום פנימי',
  description: '',
  icon: 'note',
  requirements: [],
  requires: [], // no email, no phone — nothing to deliver to
  parameters: [],
  laws: ['send_once'],
  risk: 'internal',
  preview: 'record',
  testable: false,
}

function noteExecutor(spy: { performed: number }): ActionExecutor<{ note: string }> {
  return {
    actionKey: 'note.write',
    async preflight(ctx) {
      return { ready: { note: String(ctx.parameters.body ?? '') }, problem: null }
    },
    async execute(ctx, ready) {
      spy.performed++
      return {
        kind: ctx.mode === 'live' ? 'sent' : 'would_send',
        summary: ready.note,
        log: { reason: 'note_written' },
      }
    },
  }
}

function deps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    sendMode: () => 'log',
    reclaim: vi.fn(async () => 0),
    claim: vi.fn(async () => [job()]),
    getDefinition: vi.fn(async () => def()),
    getLeadFacts: vi.fn(async () => ({
      exists: true as const,
      email: null, // deliberately NO email — a note needs none
      currentStatus: 'new',
      firstName: 'דנה',
      displayName: 'דנה לוי',
      handlerId: null,
    })),
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
    replyTo: vi.fn(async () => 'owner@business.example'),
    repName: vi.fn(async () => null),
    send: vi.fn(async () => ({ ok: true as const, id: 'msg_1' })),
    getAction: vi.fn(() => NOTE_WRITE),
    executorFor: vi.fn(),
    completeJob: vi.fn(async () => {}),
    skipJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    deadJob: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  }
}

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls

describe('criterion 2 — no engine path assumes action == email', () => {
  it('runs an invented, non-messaging action end to end', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as unknown as ActionExecutor<never>) })
    const summary = await runAutomationWorker({ deps: d })

    expect(summary).toEqual({ claimed: 1, done: 1, skipped: 0, retried: 0, dead: 0 })
    expect(spy.performed).toBe(1)
    // The email transport is never reached for an action that does not use it.
    expect(d.send).not.toHaveBeenCalled()
    expect(calls(d.appendActivity)[0][0]).toMatchObject({
      kind: 'would_send',
      mode: 'log',
      subject: 'תוכן', // the executor's OWN summary, not a rendered email subject
    })
  })

  it('a lead with no email is not blocked when the action does not require one', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as unknown as ActionExecutor<never>) })
    await runAutomationWorker({ deps: d })
    expect(calls(d.skipJob)).toEqual([])
    expect(spy.performed).toBe(1)
  })

  it('a suppressed lead still gets an internal action — suppression is per-action law', async () => {
    const spy = { performed: 0 }
    const d = deps({
      isSuppressed: vi.fn(async () => true),
      executorFor: vi.fn(() => noteExecutor(spy) as unknown as ActionExecutor<never>),
    })
    await runAutomationWorker({ deps: d })
    expect(spy.performed).toBe(1)
  })

  it('the worker asks the catalog and the registry for the DEFINITION’s action key', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as unknown as ActionExecutor<never>) })
    await runAutomationWorker({ deps: d })
    expect(calls(d.getAction)[0][0]).toBe('note.write')
    expect(calls(d.executorFor)[0][0]).toBe('note.write')
  })
})

describe('unexecutable actions fail CLOSED', () => {
  it('an action with no executor skips with action_unavailable, never a default send', async () => {
    const d = deps({ executorFor: vi.fn(() => null) })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(d.send).not.toHaveBeenCalled()
    expect(calls(d.skipJob)[0][1]).toBe('action_unavailable')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'skipped', skipReason: 'action_unavailable' })
  })

  it('an action the catalog does not describe skips the same way', async () => {
    const spy = { performed: 0 }
    const d = deps({
      getAction: vi.fn(() => null),
      executorFor: vi.fn(() => noteExecutor(spy) as unknown as ActionExecutor<never>),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(spy.performed).toBe(0)
    expect(calls(d.skipJob)[0][1]).toBe('action_unavailable')
  })

  it('a definition whose action key cannot be resolved at all is inert', async () => {
    const d = deps({
      getDefinition: vi.fn(async () => def({ actions: [], action: 'send_carrier_pigeon' } as never)),
    })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(d.send).not.toHaveBeenCalled()
    expect(calls(d.skipJob)[0][1]).toBe('action_unavailable')
  })
})

describe('the executor registry', () => {
  it('every action the catalog describes has an executor — declared means runnable', () => {
    const registered = new Set(registeredActionKeys())
    for (const action of catalog.actions) {
      expect(registered.has(action.key), `catalog action "${action.key}" has no executor`).toBe(true)
    }
  })

  it('every executor has a catalog entry — runnable means described', () => {
    for (const key of registeredActionKeys()) {
      expect(getAction(key), `executor "${key}" has no catalog entry`).toBeTruthy()
    }
  })

  it('an unknown key resolves to null rather than a default (Law 3)', () => {
    expect(executorFor('sms.send')).toBe(null)
    expect(executorFor('')).toBe(null)
  })
})

describe('action entry resolution', () => {
  it('reads the key from the actions list', () => {
    expect(actionKeyFor({ actions: [{ actionKey: 'note.write', parameters: {} }], action: 'send_email' })).toBe('note.write')
  })

  it('falls back to the engine column through the permanent bridge', () => {
    expect(actionKeyFor({ actions: [], action: 'send_email' })).toBe('email.send')
  })

  it('an unmappable engine value yields null — the worker then fails closed', () => {
    expect(actionKeyFor({ actions: [], action: 'send_carrier_pigeon' })).toBe(null)
    expect(actionKeyFor({ actions: [], action: null })).toBe(null)
  })

  it('parameters come from the entry, and default to empty rather than guessing', () => {
    expect(actionParameters({ actions: [{ actionKey: 'x', parameters: { a: 1 } }] })).toEqual({ a: 1 })
    expect(actionParameters({ actions: [] })).toEqual({})
  })

  it('the content projection is one implementation, used by every writer', () => {
    expect(actionsForContent('email.send', { subject: 'ש', body: 'ב' })).toEqual([
      { actionKey: 'email.send', parameters: { subject: 'ש', body: 'ב' } },
    ])
  })
})
