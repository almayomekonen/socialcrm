import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import { validateAction } from '@/lib/automations/catalog/validate'
import { getEvent } from '@/lib/automations/catalog/registry'
import type { ActionDefinition, EventDefinition, FieldDefinition } from '@/lib/automations/catalog/types'
import type { ActionExecutor, ExecutionContext } from '@/lib/automations/executors/types'
import { unknownTokensFor } from '@/lib/automations/variables'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * B6b ACCEPTANCE — four new actions, catalog entry + executor registration.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `task.create` · `sms.send` · `webhook.post` · `internal.note`
 *
 * Each is declared and executed HERE and run through the SHIPPED worker. None
 * required a line in `worker.ts`, `laws.ts`, `emit.ts` or any Builder file —
 * which is the phase's acceptance criterion, executed rather than asserted.
 *
 * They are deliberately awkward for an email-shaped engine: three deliver to
 * nobody, one delivers to a phone, two need a database handle and one needs an
 * HTTP client, and none of them can substitute the variables email can.
 */

const NOW = new Date('2026-08-02T12:00:00Z')

const job = (over: Partial<AutomationJob> = {}): AutomationJob => ({
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
  ...over,
})

// ── The four catalog entries ───────────────────────────────────────────────

const TASK_CREATE: ActionDefinition = {
  key: 'task.create',
  title: 'יצירת משימה לנציג',
  description: 'פותח משימה לנציג המטפל',
  icon: 'list-check',
  requirements: [],
  requires: [], // delivers to nobody
  parameters: [{ key: 'title', type: 'text', label: 'כותרת המשימה', validation: { required: true } }],
  // The frozen §3.8 table: a suppressed lead must STILL get a task.
  laws: ['send_once'],
  risk: 'internal',
  preview: 'record',
  testable: false,
}

const SMS_SEND: ActionDefinition = {
  key: 'sms.send',
  title: 'שליחת הודעת טקסט',
  description: 'שולח הודעת טקסט לליד',
  icon: 'comment',
  requirements: [],
  requires: ['phone'],
  parameters: [{ key: 'body', type: 'text', label: 'תוכן ההודעה', validation: { required: true } }],
  laws: ['send_once', 'per_lead_cap', 'agency_cap', 'quiet_hours'],
  risk: 'external',
  preview: 'message',
  testable: false,
}

const WEBHOOK_POST: ActionDefinition = {
  key: 'webhook.post',
  title: 'שליחת התראה למערכת חיצונית',
  description: 'שולח את פרטי הליד לכתובת שהוגדרה',
  icon: 'arrow-up-right-from-square',
  requirements: [],
  requires: [],
  parameters: [{ key: 'url', type: 'text', label: 'כתובת היעד', validation: { required: true } }],
  laws: ['send_once'],
  risk: 'external',
  preview: 'none',
  testable: false,
}

const INTERNAL_NOTE: ActionDefinition = {
  key: 'internal.note',
  title: 'רישום הערה פנימית',
  description: 'מוסיף הערה לכרטיס הליד',
  icon: 'note-sticky',
  requirements: [],
  requires: [],
  parameters: [{ key: 'text', type: 'text', label: 'תוכן ההערה', validation: { required: true } }],
  laws: ['send_once'],
  risk: 'internal',
  preview: 'record',
  testable: false,
}

// ── The four executors, each with its OWN dependencies ─────────────────────

type Spy = { calls: unknown[] }

/** Needs a database handle. No transport anywhere in sight. */
const taskExecutor = (spy: Spy): ActionExecutor<{ title: string }, { createTask: (t: unknown) => Promise<void> }> => ({
  actionKey: TASK_CREATE.key,
  resolvableFields: [],
  defaultDeps: () => ({ createTask: async (t) => void spy.calls.push(t) }),
  async preflight(ctx) {
    return { ready: { title: String(ctx.parameters.title ?? '') }, problem: null }
  },
  async execute(ctx, ready, deps) {
    if (ctx.mode === 'live') await deps.createTask({ leadId: ctx.leadId, title: ready.title })
    return {
      kind: ctx.mode === 'live' ? 'sent' : 'would_send',
      summary: ready.title,
      log: { reason: 'task_created' },
    }
  },
})

/** Needs a phone recipient and its own gateway. */
const smsExecutor = (spy: Spy): ActionExecutor<{ body: string }, { sendSms: (a: unknown) => Promise<string> }> => ({
  actionKey: SMS_SEND.key,
  // Its own, smaller vocabulary — it cannot render a business signature.
  resolvableFields: ['leadFirstName'],
  defaultDeps: () => ({
    sendSms: async (a) => {
      spy.calls.push(a)
      return 'sms_1'
    },
  }),
  async preflight(ctx) {
    return { ready: { body: String(ctx.parameters.body ?? '') }, problem: null }
  },
  async execute(ctx, ready, deps) {
    const to = ctx.recipients.phone
    if (ctx.mode !== 'live' || !to) return { kind: 'would_send', summary: ready.body, log: { reason: 'log_mode' } }
    const id = await deps.sendSms({ to, body: ready.body })
    return { kind: 'sent', summary: ready.body, providerMessageId: id, log: { reason: 'gateway_accepted' } }
  },
})

/** Needs an HTTP client, and refuses to run without a URL. */
const webhookExecutor = (spy: Spy): ActionExecutor<{ url: string }, { post: (u: string) => Promise<void> }> => ({
  actionKey: WEBHOOK_POST.key,
  resolvableFields: [],
  defaultDeps: () => ({ post: async (u) => void spy.calls.push(u) }),
  async preflight(ctx) {
    const url = String(ctx.parameters.url ?? '')
    if (!url.startsWith('https://')) {
      return {
        ready: null,
        problem: {
          reason: 'url_invalid',
          deadReason: 'webhook_unavailable:url_invalid',
          warnTransition: 'webhook_incomplete',
          logClass: 'configuration',
        },
      }
    }
    return { ready: { url }, problem: null }
  },
  async execute(ctx, ready, deps) {
    if (ctx.mode === 'live') await deps.post(ready.url)
    return { kind: ctx.mode === 'live' ? 'sent' : 'would_send', summary: ready.url, log: { reason: 'posted' } }
  },
})

/** Needs nothing at all. */
const noteExecutor = (spy: Spy): ActionExecutor<{ text: string }, Record<string, never>> => ({
  actionKey: INTERNAL_NOTE.key,
  resolvableFields: ['leadFirstName'],
  defaultDeps: () => ({}),
  async preflight(ctx) {
    return { ready: { text: String(ctx.parameters.text ?? '') }, problem: null }
  },
  async execute(ctx, ready) {
    spy.calls.push(ready.text)
    return { kind: ctx.mode === 'live' ? 'sent' : 'would_send', summary: ready.text, log: { reason: 'noted' } }
  },
})

// ── An event that can carry a phone, declared as catalog data ──────────────

const PHONE_FIELD: FieldDefinition = {
  key: 'phone',
  type: 'phone',
  label: 'טלפון הליד',
  freshness: 'live',
  lifecycle: 'stable',
}

const EVENT_WITH_PHONE: EventDefinition = {
  ...(getEvent('lead.created') as EventDefinition),
  fields: [...(getEvent('lead.created') as EventDefinition).fields, PHONE_FIELD],
}

// ── Harness ────────────────────────────────────────────────────────────────

const def = (action: ActionDefinition, parameters: Record<string, unknown>): WorkerDefinition =>
  ({
    id: 3,
    agencyId: 7,
    name: 'אוטומציה',
    recipeKey: null,
    status: 'active',
    trigger: 'lead_created',
    action: 'send_email', // the legacy column; the actions LIST is authoritative
    content: { schemaVersion: 1, subject: 's', body: 'b', timing: { kind: 'preset', preset: 'immediate' } },
    createdByUserId: 1,
    conditions: [],
    actions: [{ actionKey: action.key, parameters }],
    connectionId: null,
    sourceIds: [],
  }) as unknown as WorkerDefinition

let lead = {
  exists: true as const,
  email: null as string | null,
  phone: null as string | null,
  currentStatus: 'new',
  firstName: 'דנה',
  displayName: 'דנה לוי',
  handlerId: null as number | null,
}

beforeEach(() => {
  lead = { ...lead, email: null, phone: null }
})

function deps(action: ActionDefinition, executor: ActionExecutor<never, never>, over: Partial<WorkerDeps> = {}) {
  return {
    sendMode: () => 'log' as const,
    reclaim: vi.fn(async () => 0),
    claim: vi.fn(async () => [job()]),
    getDefinition: vi.fn(async () => def(action, { title: 'x', body: 'x', url: 'https://x.example', text: 'x' })),
    getLeadFacts: vi.fn(async () => lead),
    isSuppressed: vi.fn(async () => false),
    isRecipientBlocked: vi.fn(async () => false),
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
    getAction: vi.fn(() => action),
    executorFor: vi.fn(() => executor),
    completeJob: vi.fn(async () => {}),
    skipJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    deadJob: vi.fn(async () => {}),
    now: () => NOW,
    ...over,
  } as unknown as WorkerDeps
}

const calls = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls

// ══════════════════════════════════════════════════════════════════════════

describe('all four validate against the frozen catalog schema', () => {
  for (const action of [TASK_CREATE, SMS_SEND, WEBHOOK_POST, INTERNAL_NOTE]) {
    it(`${action.key} is a legal catalog entry`, () => {
      expect(validateAction(action)).toEqual([])
    })
  }
})

describe('task.create — the §3.8 correctness case', () => {
  it('runs, and the worker supplies it no capability whatsoever', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(TASK_CREATE, taskExecutor(spy) as never)
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'would_send', subject: 'x' })
  })

  it('a SUPPRESSED lead still gets the task — suppression is not declared', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(TASK_CREATE, taskExecutor(spy) as never, { isSuppressed: vi.fn(async () => true) })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
  })

  it('and caps do not apply to it either', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(TASK_CREATE, taskExecutor(spy) as never, {
      countLeadToday: vi.fn(async () => 999),
      countAgencyToday: vi.fn(async () => 99999),
    })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
  })

  it('its own dependency is reached in live mode, and no transport exists to reach', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(TASK_CREATE, taskExecutor(spy) as never, { sendMode: () => 'live' })
    await runAutomationWorker({ deps: d })
    expect(spy.calls).toEqual([{ leadId: 42, title: 'x' }])
  })
})

describe('sms.send — a recipient that is not an email address', () => {
  it('skips with no_phone when the lead has none — a reason of its own, not no_email', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(SMS_SEND, smsExecutor(spy) as never, {
      getAction: vi.fn(() => SMS_SEND),
      // The event declares a phone field; `requires: ['phone']` finds it.
      getDefinition: vi.fn(async () => def(SMS_SEND, { body: 'שלום' })),
    })
    vi.spyOn(await import('@/lib/automations/catalog/registry'), 'getEvent').mockReturnValue(EVENT_WITH_PHONE)
    const summary = await runAutomationWorker({ deps: d })
    expect(summary.skipped).toBe(1)
    expect(calls(d.skipJob)[0][1]).toBe('no_phone')
    vi.restoreAllMocks()
  })

  it('sends through its OWN gateway when the lead has a phone', async () => {
    const spy: Spy = { calls: [] }
    lead = { ...lead, phone: '0501234567' }
    vi.spyOn(await import('@/lib/automations/catalog/registry'), 'getEvent').mockReturnValue(EVENT_WITH_PHONE)
    const d = deps(SMS_SEND, smsExecutor(spy) as never, {
      sendMode: () => 'live',
      getDefinition: vi.fn(async () => def(SMS_SEND, { body: 'שלום' })),
    })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
    expect(spy.calls).toEqual([{ to: '0501234567', body: 'שלום' }])
    expect(calls(d.appendActivity)[0][0]).toMatchObject({ kind: 'sent', providerMessageId: 'sms_1' })
    vi.restoreAllMocks()
  })

  it('a blocked recipient is not an email concept — the generic law catches it', async () => {
    const spy: Spy = { calls: [] }
    lead = { ...lead, phone: '0501234567' }
    vi.spyOn(await import('@/lib/automations/catalog/registry'), 'getEvent').mockReturnValue(EVENT_WITH_PHONE)
    const withBlock: ActionDefinition = { ...SMS_SEND, laws: [...SMS_SEND.laws, 'bounce_block'] }
    const d = deps(withBlock, smsExecutor(spy) as never, {
      isRecipientBlocked: vi.fn(async () => true),
      getDefinition: vi.fn(async () => def(withBlock, { body: 'שלום' })),
    })
    expect((await runAutomationWorker({ deps: d })).skipped).toBe(1)
    expect(calls(d.skipJob)[0][1]).toBe('address_undeliverable')
    vi.restoreAllMocks()
  })
})

describe('webhook.post — a preflight that is not about identity', () => {
  it('dies in live mode with ITS OWN reason and log class', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(WEBHOOK_POST, webhookExecutor(spy) as never, {
      sendMode: () => 'live',
      getDefinition: vi.fn(async () => def(WEBHOOK_POST, { url: 'ftp://nope' })),
    })
    expect((await runAutomationWorker({ deps: d })).dead).toBe(1)
    expect(d.deadJob).toHaveBeenCalledWith(1, 'webhook_unavailable:url_invalid')
    // The claim is never consumed for a configuration fault (ADR-013), and
    // the worker learned that rule once — for email — and now applies it here.
    expect(d.claimOnce).not.toHaveBeenCalled()
  })

  it('posts to its own client when configured', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(WEBHOOK_POST, webhookExecutor(spy) as never, { sendMode: () => 'live' })
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
    expect(spy.calls).toEqual(['https://x.example'])
  })
})

describe('internal.note — an action with no dependencies at all', () => {
  it('runs on an empty dependency object', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(INTERNAL_NOTE, noteExecutor(spy) as never)
    expect((await runAutomationWorker({ deps: d })).done).toBe(1)
    expect(spy.calls).toEqual(['x'])
  })
})

describe('variable validation follows the ACTION, not email', () => {
  it('email’s three variables are rejected for an action that resolves fewer', () => {
    const content = 'שלום {{שם הליד}} מ{{שם העסק}}'
    // sms.send declares only leadFirstName, so the business name is unknown TO IT.
    expect(unknownTokensFor(['leadFirstName'], content)).toEqual(['שם העסק'])
    expect(unknownTokensFor(['leadFirstName', 'businessName'], content)).toEqual([])
  })

  it('an action that resolves nothing rejects every variable', () => {
    expect(unknownTokensFor([], 'שלום {{שם הליד}}')).toEqual(['שם הליד'])
  })

  it('and plain content is fine for all of them', () => {
    expect(unknownTokensFor([], 'שלום')).toEqual([])
  })
})

describe('the worker is action-agnostic — proven by what it never did', () => {
  it('never asked any of the four for a transport, an identity or a renderer', async () => {
    const spies = [
      { action: TASK_CREATE, make: taskExecutor },
      { action: WEBHOOK_POST, make: webhookExecutor },
      { action: INTERNAL_NOTE, make: noteExecutor },
    ]
    for (const { action, make } of spies) {
      const spy: Spy = { calls: [] }
      const d = deps(action, make(spy) as never)
      await runAutomationWorker({ deps: d })
      // The only subject field the worker resolved is what the EXECUTOR asked
      // for. None of these three want a business name, so it was never fetched.
      expect(calls(d.agencyName).length, `${action.key} caused an agency lookup`).toBe(0)
    }
  })

  it('resolves recipients ONLY for the types the action requires', async () => {
    const spy: Spy = { calls: [] }
    const d = deps(TASK_CREATE, taskExecutor(spy) as never, { sendMode: () => 'live' })
    await runAutomationWorker({ deps: d })
    // `requires: []` ⇒ nothing to look up, so no deliverability check happens.
    expect(calls(d.isRecipientBlocked).length).toBe(0)
  })

  it('hands each executor a context it can read without knowing the others exist', async () => {
    let seen: ExecutionContext | null = null
    const probe: ActionExecutor<null, Record<string, never>> = {
      actionKey: INTERNAL_NOTE.key,
      resolvableFields: ['leadFirstName', 'repName'],
      defaultDeps: () => ({}),
      async preflight(ctx) {
        seen = ctx
        return { ready: null, problem: null }
      },
      async execute() {
        return { kind: 'would_send', summary: null, log: {} }
      },
    }
    await runAutomationWorker({ deps: deps(INTERNAL_NOTE, probe as never) })
    expect(seen!.subject).toEqual({ leadFirstName: 'דנה', repName: null })
    expect(seen!.recipients).toEqual({})
    expect(seen!.parameters).toMatchObject({ text: 'x' })
  })
})
