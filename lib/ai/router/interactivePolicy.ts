/**
 * Interactive Router Policy — bounds wall-clock latency for user-facing tasks.
 *
 * The legacy failover loop was sequential with a per-attempt timeout and no global
 * deadline, so a slow provider chain could take ~33s (measured). For an interactive
 * answer that is worthless — the user has long since given up. These two pure
 * helpers add a hard wall-clock budget and fail-fast-on-timeout, gated entirely by
 * optional task config so non-interactive tasks keep their exact legacy behavior.
 */
import type { TaskConfig } from '../tasks'

/** Below this remaining budget, a fresh attempt can't meaningfully complete — stop and fall back. */
export const MIN_ATTEMPT_MS = 500

export interface AttemptBudget {
  /** True when the wall-clock budget is exhausted: stop trying, fall back fast. */
  stop: boolean
  /** Per-attempt timeout, clamped so no single attempt can overrun the global deadline. */
  timeoutMs: number
}

export function attemptBudget(cfg: TaskConfig, startedAt: number, now: number): AttemptBudget {
  if (cfg.deadlineMs == null) {
    // Legacy: no global deadline — per-attempt timeout unchanged, never stops early.
    return { stop: false, timeoutMs: cfg.timeoutMs }
  }
  const remaining = startedAt + cfg.deadlineMs - now
  if (remaining <= MIN_ATTEMPT_MS) return { stop: true, timeoutMs: 0 }
  return { stop: false, timeoutMs: Math.min(cfg.timeoutMs, remaining) }
}

/** On a timeout, skip same-provider retries (retrying a slow provider only burns budget). */
export function skipRetryOnTimeout(cfg: TaskConfig, errorCode: string): boolean {
  return cfg.failFastOnTimeout === true && errorCode === 'timeout'
}
