import { describe, expect, it, vi } from 'vitest'
import { MISSING_MEETING } from '@/lib/automations/appointments'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { executorFor, registeredActionKeys } from '@/lib/automations/executors/registry'
import { catalog } from '@/lib/automations/catalog/registry'
import { getAction } from '@/lib/automations/catalog/registry'
import type { ActionDefinition } from '@/lib/automations/catalog/types'
import type { ActionExecutor } from '@/lib/automations/executors/types'
import {
  actionKeyFor,
  actionParameters,
  actionParametersFromContent,
  actionsForContent,
  authoredContentOf,
} from '@/lib/automations/actionEntry'

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

function noteExecutor(spy: { performed: number }): ActionExecutor<{ note: string }, Record<string, never>> {
  return {
    actionKey: 'note.write',
    // An internal action substitutes nothing and needs nothing — which is the
    // whole point: the worker supplies neither.
    resolvableFields: [],
    defaultDeps: () => ({}),
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
  it('runs an invented, non-messaging action end to end — the worker supplies it nothing', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as never) as never })
    const summary = await runAutomationWorker({ deps: d })

    expect(summary).toEqual({ claimed: 1, done: 1, skipped: 0, retried: 0, dead: 0 })
    expect(spy.performed).toBe(1)
    expect(calls(d.appendActivity)[0][0]).toMatchObject({
      kind: 'would_send',
      mode: 'log',
      subject: 'תוכן', // the executor's OWN summary, not a rendered email subject
    })
  })

  it('a lead with no email is not blocked when the action does not require one', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as never) as never })
    await runAutomationWorker({ deps: d })
    expect(calls(d.skipJob)).toEqual([])
    expect(spy.performed).toBe(1)
  })

  it('a suppressed lead still gets an internal action — suppression is per-action law', async () => {
    const spy = { performed: 0 }
    const d = deps({
      isSuppressed: vi.fn(async () => true),
      executorFor: vi.fn(() => noteExecutor(spy) as never) as never,
    })
    await runAutomationWorker({ deps: d })
    expect(spy.performed).toBe(1)
  })

  it('the worker asks the catalog and the registry for the DEFINITION’s action key', async () => {
    const spy = { performed: 0 }
    const d = deps({ executorFor: vi.fn(() => noteExecutor(spy) as never) as never })
    await runAutomationWorker({ deps: d })
    expect(calls(d.getAction)[0][0]).toBe('note.write')
    expect(calls(d.executorFor)[0][0]).toBe('note.write')
  })
})

describe('unexecutable actions fail CLOSED', () => {
  it('an action with no executor skips with action_unavailable, never a default send', async () => {
    const d = deps({ executorFor: vi.fn(() => null) as never })
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(calls(d.skipJob)[0][1]).toBe('action_unavailable')
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'skipped', skipReason: 'action_unavailable' })
  })

  it('an action the catalog does not describe skips the same way', async () => {
    const spy = { performed: 0 }
    const d = deps({
      getAction: vi.fn(() => null),
      executorFor: vi.fn(() => noteExecutor(spy) as never) as never,
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

  /**
   * `task.create` reads `parameters.title`. The projection carried subject,
   * body, the CTA pair and the template pair — but never a title — so the
   * authored value was stored on `content` and dropped one line before the
   * executor, and EVERY automated task was created with an empty title.
   */
  it('projects a title-shaped action’s parameter, so the task is not created blank', () => {
    expect(actionsForContent('task.create', { subject: '', body: '', title: 'ליד חדש — {{שם הליד}}' })).toEqual([
      { actionKey: 'task.create', parameters: { subject: '', body: '', title: 'ליד חדש — {{שם הליד}}' } },
    ])
  })

  it('an email automation’s parameters are unchanged — no title appears from nowhere', () => {
    expect(actionParametersFromContent({ subject: 'ש', body: 'ב' })).toEqual({ subject: 'ש', body: 'ב' })
    // Whitespace is not a title: an all-spaces value is absent, not empty.
    expect(actionParametersFromContent({ subject: 'ש', body: 'ב', title: '   ' })).toEqual({ subject: 'ש', body: 'ב' })
  })

  /**
   * The generic bag: answers to whatever parameters the CATALOG declares, which
   * is how a first-party (`enum_agency`) selection reaches an executor without
   * this projection learning what the parameter means.
   */
  it('projects catalog-declared parameter answers by their own key', () => {
    expect(
      actionParametersFromContent({ subject: '', body: '', actionParameters: { quoteTemplateId: '42' } }),
    ).toEqual({ subject: '', body: '', quoteTemplateId: '42' })
  })

  it('an empty or absent bag leaves the projection byte-identical', () => {
    expect(actionParametersFromContent({ subject: 'ש', body: 'ב', actionParameters: null })).toEqual({
      subject: 'ש',
      body: 'ב',
    })
    expect(actionParametersFromContent({ subject: 'ש', body: 'ב', actionParameters: { a: '  ' } })).toEqual({
      subject: 'ש',
      body: 'ב',
    })
  })
})

/**
 * DUPLICATION MUST NOT LOSE CONFIGURATION.
 *
 * `duplicateAutomation` rebuilt the content document by naming subject, body
 * and timing, so every field added afterwards was silently dropped: a copied
 * WhatsApp automation lost the template it could only send with, and a copied
 * email lost its CTA button. Neither reported anything.
 */
describe('the authored content document survives duplication whole', () => {
  const stored = {
    schemaVersion: 1,
    subject: 'ש',
    body: 'ב',
    timing: { kind: 'preset', preset: 'one_day' } as const,
    ctaLabel: 'לקביעת שיחה',
    ctaUrl: 'https://example.co.il/book',
    templateId: 42,
    templateBindings: { '1': 'leadFirstName' },
    title: 'כותרת',
  }

  it('carries every authored field, and drops only the version stamp', () => {
    const copied = authoredContentOf(stored)
    expect(copied).toEqual({
      subject: 'ש',
      body: 'ב',
      timing: { kind: 'preset', preset: 'one_day' },
      ctaLabel: 'לקביעת שיחה',
      ctaUrl: 'https://example.co.il/book',
      templateId: 42,
      templateBindings: { '1': 'leadFirstName' },
      title: 'כותרת',
    })
    expect('schemaVersion' in copied).toBe(false)
  })

  it('a copied messaging automation keeps the template it can only send with', () => {
    const copied = authoredContentOf(stored)
    expect(actionsForContent('whatsapp.send', copied).at(0)?.parameters).toMatchObject({
      templateId: 42,
      templateBindings: { '1': 'leadFirstName' },
    })
  })

  it('tolerates an empty document rather than throwing on a malformed row', () => {
    expect(authoredContentOf(null)).toEqual({})
    expect(authoredContentOf(undefined)).toEqual({})
  })
})

/**
 * B6b — the executor is the AUTHORITY on which variables exist; the Builder's
 * client-side chip constant is pinned to it.
 *
 * The chip list must stay a client-safe constant (importing an executor into
 * the Builder would drag a renderer into the browser bundle), so the two are
 * kept honest by assertion rather than by derivation. If they ever diverge,
 * a chip would offer a token the executor cannot substitute — a raw
 * `{{token}}` in a real customer email.
 */
describe('variable authority', () => {
  it('the Builder’s chip source equals the email executor’s declaration', async () => {
    const { emailExecutor } = await import('@/lib/automations/executors/email')
    const { AUTOMATION_EMAIL_VARIABLES } = await import('@/lib/automations/variables')
    expect([...emailExecutor.resolvableFields]).toEqual(AUTOMATION_EMAIL_VARIABLES.map((v) => v.field))
  })

  /**
   * The same pin for the title-shaped action. `task.create` resolves only the
   * lead's own name — a task title is read by the rep off their worklist, and
   * the business's own name in it would say nothing. Offering a wider chip set
   * would let the customer insert a token the executor leaves as literal
   * `{{...}}` text on a real task.
   */
  it('the Builder’s title chips equal the task executor’s declaration', async () => {
    const { taskExecutor } = await import('@/lib/automations/executors/task')
    const { TITLE_VARIABLE_FIELDS } = await import('@/components/settings/automations/AutomationTitleSection')
    expect([...TITLE_VARIABLE_FIELDS]).toEqual([...taskExecutor.resolvableFields])
  })

  it('every title chip has a token in the shared vocabulary', async () => {
    const { TITLE_VARIABLE_FIELDS } = await import('@/components/settings/automations/AutomationTitleSection')
    const { variableTokenFor } = await import('@/lib/automations/variables')
    for (const field of TITLE_VARIABLE_FIELDS) {
      expect(variableTokenFor(field), `no token for "${field}"`).toBeTruthy()
    }
  })

  it('every declared field has a token, so a declaration can always be typed', async () => {
    const { emailExecutor } = await import('@/lib/automations/executors/email')
    const { variableTokenFor } = await import('@/lib/automations/variables')
    for (const field of emailExecutor.resolvableFields) {
      expect(variableTokenFor(field), `no token for "${field}"`).toBeTruthy()
    }
  })

  it('an unregistered action resolves nothing — never email’s set by default', async () => {
    const { resolvableFieldsFor } = await import('@/lib/automations/executors/registry')
    expect(resolvableFieldsFor('sms.send')).toEqual([])
  })
})
