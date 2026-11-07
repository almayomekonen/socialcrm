import type { DeliveryState } from '@/db/automations/activity'
import type { SubjectValues } from '../subject'
import type { SkipReason } from '../types'

/**
 * ACTION EXECUTORS — the generic contract for "doing the thing".
 *
 * Frozen architecture §3.8 / Law 4: laws live in the engine, effects live in
 * actions. Before B5 the worker WAS the email sender; after B5 the worker
 * became a state machine that dispatches to an executor. B6b finishes the job:
 * the worker no longer supplies an executor's capabilities either.
 *
 * TWO PHASES, because the engine's ordering rules demand it:
 *
 *   preflight() runs BEFORE the send-once claim (ADR-013). An unresolvable
 *   configuration is a fault of the business's setup, not of the lead; burning
 *   the lead's once-ever allowance on it would mean the lead never receives
 *   the message even after the configuration is fixed.
 *
 *   execute() runs AFTER the claim. Throwing releases the claim and the job
 *   retries; returning normally confirms it.
 *
 * The executor reports what to LOG and what to RECORD; the worker decides the
 * job's fate. That split is what keeps ADR-011's state machine in one place
 * while the effect lives in another.
 *
 * DEPENDENCIES ARE THE EXECUTOR'S OWN (B6b). `defaultDeps()` is how an executor
 * reaches a transport, a table or an API without the worker ever declaring it.
 * A `task.create` executor needs no transport and a `webhook.post` executor
 * needs no mailer — under the pre-B6b contract both would have forced a new
 * field into the worker's dependency record. Now neither touches it.
 */

export type ExecutionMode = 'live' | 'log'

/** Everything an executor may know about the occurrence it is acting on. */
export type ExecutionContext = {
  agencyId: number
  automationId: number
  leadId: number
  mode: ExecutionMode
  /**
   * The subject's live values, keyed by CATALOG FIELD KEY. Generic on purpose:
   * an executor asks for `leadFirstName` or `phone` by name, and no layer
   * between it and the lead row has to know which fields exist.
   */
  subject: SubjectValues
  /**
   * The delivery targets the action's `requires` resolved to, keyed by the
   * same catalog field key. Empty for an action that delivers to nobody.
   */
  recipients: Record<string, string | null>
  /** The action entry's stored parameters. Shape is the action's own business. */
  parameters: Record<string, unknown>
}

/**
 * A configuration fault found before the claim. Definitive — never retried,
 * because a retry storm cannot fix a misconfiguration.
 */
export type PreflightProblem = {
  /** Short cause, surfaced in the structured log. */
  reason: string
  /** Persisted on the dead job row. */
  deadReason: string
  /** Log transition name used when the mode makes this non-blocking. */
  warnTransition: string
  /** Log classification, so one grep finds every fault of this kind. */
  logClass: string
}

/**
 * Nullable-field pair, not a discriminated union: this repo compiles with
 * `strictNullChecks: false`, under which boolean discriminants do not narrow.
 * `problem` non-null ⇔ `ready` null.
 */
export type PreflightResult<TReady> = { ready: TReady | null; problem: PreflightProblem | null }

/**
 * What actually happened. `sent` means an external effect really occurred;
 * `would_send` means the engine proved it would and deliberately did not
 * (observation mode, ADR-009).
 */
export type ExecutionOutcome = {
  kind: 'sent' | 'would_send'
  /**
   * One-line human summary recorded on the activity row. Persisted in the
   * `subject` column — an email-era name for a generic idea; the column is
   * live production data and renaming it would be a migration of meaning.
   */
  summary: string | null
  deliveryState?: DeliveryState | null
  providerMessageId?: string | null
  /** Structured fields for the worker's transition log line. */
  log: Record<string, unknown>
}

/**
 * The "שלח אליי בדיקה" contract (frozen §3.9). Generic so the affordance works
 * for any future channel without the Builder — or this type — learning what
 * the channel is: the action declares `testable`, the executor implements
 * `test`, and the caller supplies only who the sample goes to.
 */
export type TestTarget = { agencyId: number; toName: string | null; address: string }
export type TestResult = { ok: true } | { ok: false; reason: string }

/**
 * The Builder preview contract.
 *
 * Generic for the same reason `test` is: the Builder asks the ACTION to render
 * what it would produce, and never learns that this one produces email.
 *
 * It exists because the Builder used to draw its own approximation of the email
 * in app typography — one paragraph, no footer, placeholder business name — so
 * the customer could not see what they were sending. The glued-signature defect
 * shipped through that gap. Preview and send now come from ONE renderer.
 *
 * `subjectLine`/`fromName` are returned separately so the Builder can show the
 * inbox row honestly, including the business name the From header will carry.
 */
export type PreviewTarget = { agencyId: number; toName: string | null }

/**
 * Previews are discriminated by `shape`, matching the catalog's `PREVIEW_SHAPES`
 * vocabulary — which listed `'message'` from the start for the channel that had
 * not arrived yet.
 *
 * `shape` is REQUIRED on both, deliberately. An optional discriminant would let
 * a new channel's preview be mistaken for an email by any consumer that forgot
 * to check, and an email pane fed message text renders nothing at all.
 */
export type PreviewResult =
  | { ok: true; shape: 'email'; html: string; subjectLine: string; fromName: string }
  /**
   * A chat message: one body of text, no subject and no From name, because a
   * WhatsApp message has neither. `notApproved` lets the Builder say that this
   * template cannot currently be sent while still showing what it says — the
   * customer needs both facts at once.
   */
  | { ok: true; shape: 'message'; text: string; notApproved?: boolean }
  | { ok: false; reason: string }

export type ActionExecutor<TReady = unknown, TDeps = unknown> = {
  /** The CATALOG key (`email.send`), never the engine's persisted value. */
  actionKey: string
  /**
   * Subject field keys this executor can substitute into its parameters.
   * The AUTHORITY for variable validation: content may reference these and
   * nothing else, whatever action it belongs to.
   */
  resolvableFields: readonly string[]
  /** Production wiring. The worker calls this; tests override the result. */
  defaultDeps(): TDeps
  preflight(ctx: ExecutionContext, deps: TDeps): Promise<PreflightResult<TReady>>
  execute(ctx: ExecutionContext, ready: TReady, deps: TDeps): Promise<ExecutionOutcome>
  /** Present only when the catalog marks the action `testable`. */
  test?(parameters: Record<string, unknown>, target: TestTarget, deps: TDeps): Promise<TestResult>
  /** Present when the action can render a faithful preview of its output. */
  preview?(parameters: Record<string, unknown>, target: PreviewTarget, deps: TDeps): Promise<PreviewResult>
}

/** An executor erased of its own dependency type — how the worker holds one. */
export type AnyActionExecutor = ActionExecutor<never, never>

/**
 * Thrown by `execute` when the effect was refused at the last moment for a
 * reason the laws also know (e.g. `opted_out`: the lead opted out after the law
 * check). The worker ends the job as that skip — never a retry, never a failure.
 */
export class ExecutionSkippedError extends Error {
  readonly executionSkipped = true as const
  constructor(readonly reason: SkipReason) {
    super(`execution_skipped: ${reason}`)
    this.name = 'ExecutionSkippedError'
  }
}

export function isExecutionSkippedError(err: unknown): err is ExecutionSkippedError {
  return (
    err instanceof ExecutionSkippedError ||
    (!!err && typeof err === 'object' && (err as { name?: unknown }).name === 'ExecutionSkippedError' &&
      (err as { executionSkipped?: unknown }).executionSkipped === true)
  )
}

/**
 * Thrown by `execute` when the effect's outcome is UNKNOWN: the request reached
 * the provider and no answer came back (timeout, dropped connection, no message
 * id). The effect may have happened. The worker treats it exactly like an
 * unconfirmed claim after a crash (ADR-011): dead, user-visible, and the claim is
 * KEPT, so neither a retry nor a later trigger can send it a second time.
 */
export class ExecutionOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true as const
  constructor(readonly detail: string) {
    super(`execution_outcome_unknown: ${detail}`)
    this.name = 'ExecutionOutcomeUnknownError'
  }
}

export function isExecutionOutcomeUnknownError(err: unknown): err is ExecutionOutcomeUnknownError {
  return (
    err instanceof ExecutionOutcomeUnknownError ||
    (!!err && typeof err === 'object' && (err as { name?: unknown }).name === 'ExecutionOutcomeUnknownError' &&
      (err as { outcomeUnknown?: unknown }).outcomeUnknown === true)
  )
}
