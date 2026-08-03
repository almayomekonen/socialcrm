import type { DeliveryState } from '@/db/automations/activity'

/**
 * ACTION EXECUTORS — the generic contract for "doing the thing".
 *
 * Frozen architecture §3.8 / Law 4: laws live in the engine, effects live in
 * actions. Before B5 the worker WAS the email sender; after B5 the worker is
 * a state machine that knows nothing about email, and `email.send` is simply
 * the first registered executor.
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
 */

export type ExecutionMode = 'live' | 'log'

/** Everything an executor may know about the occurrence it is acting on. */
export type ExecutionContext = {
  agencyId: number
  automationId: number
  leadId: number
  mode: ExecutionMode
  /** The subject's facts. `exists: false` never reaches an executor (law). */
  lead: {
    firstName: string | null
    displayName: string | null
    email: string | null
    handlerId: number | null
  }
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
 * Capabilities an executor may draw on. Deliberately a structural subset of
 * the worker's dependency record, so tests inject one object and both layers
 * see the parts they need.
 */
export type ExecutorDeps = {
  agencyName: (agencyId: number) => Promise<string | null>
  replyTo: (agencyId: number) => Promise<string | null>
  repName: (userId: number | null) => Promise<string | null>
  send: (args: {
    from: string
    replyTo: string
    to: string
    subject: string
    html: string
    text: string
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
}

export type ActionExecutor<TReady = unknown> = {
  /** The CATALOG key (`email.send`), never the engine's persisted value. */
  actionKey: string
  preflight(ctx: ExecutionContext, deps: ExecutorDeps): Promise<PreflightResult<TReady>>
  execute(ctx: ExecutionContext, ready: TReady, deps: ExecutorDeps): Promise<ExecutionOutcome>
}
