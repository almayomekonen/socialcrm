import type { StopReason } from './types'

/**
 * Investigation budget — PURE, and owned by SocialCRM, never by the model.
 *
 * The model may ask for another step; this decides. It is consulted INSIDE each
 * tool's execute, not only at the loop level, so a model that ignores the
 * runtime's own step cap still cannot exceed it.
 *
 * Four independent stops:
 *   · step ceiling        — a hard cap on tool calls per question
 *   · wall-clock deadline — the rep is waiting; a late answer is worthless
 *   · repeat call         — the same tool with the same arguments answers nothing
 *   · no new information  — two consecutive results identical to the previous
 *
 * The novelty rule exists because a model that keeps re-asking a question it has
 * already answered would otherwise burn the whole ceiling. A repeat call is
 * deliberately NOT terminal: the model may still make a different, useful call.
 *
 * No clock read of its own — `now` is injected so every rule is testable.
 */

/** Hard cap on tool calls in one investigation. */
export const DEFAULT_MAX_STEPS = 6

/** Wall-clock ceiling across all steps. */
export const DEFAULT_DEADLINE_MS = 40_000

/** Consecutive identical results that end the investigation. */
const NO_NEW_INFO_LIMIT = 2

export type BudgetVerdict = { allowed: true } | { allowed: false; reason: StopReason }

export type Budget = {
  /** May this tool call proceed? Consuming a step only when allowed. */
  canStep(toolName: string, argsKey: string): BudgetVerdict
  /** Record a result fingerprint so the novelty rule can see repetition. */
  noteResult(resultHash: string): void
  stepsUsed(): number
  /** The terminal stop, or null while the investigation may continue. */
  reason(): StopReason | null
}

export type CreateBudgetOptions = {
  maxSteps?: number
  deadlineMs?: number
  /** Injectable clock. Defaults to Date.now. */
  now?: () => number
}

export function createBudget(opts?: CreateBudgetOptions): Budget {
  const maxSteps = opts?.maxSteps ?? DEFAULT_MAX_STEPS
  const deadlineMs = opts?.deadlineMs ?? DEFAULT_DEADLINE_MS
  const now = opts?.now ?? (() => Date.now())
  const startedAt = now()

  const seenCalls = new Set<string>()
  let steps = 0
  let lastHash: string | null = null
  let repeatedResults = 0
  let stop: StopReason | null = null

  return {
    canStep(toolName, argsKey) {
      if (stop) return { allowed: false, reason: stop }

      if (now() - startedAt >= deadlineMs) {
        stop = 'deadline'
        return { allowed: false, reason: stop }
      }
      if (steps >= maxSteps) {
        stop = 'step_ceiling'
        return { allowed: false, reason: stop }
      }
      if (repeatedResults >= NO_NEW_INFO_LIMIT) {
        stop = 'no_new_information'
        return { allowed: false, reason: stop }
      }

      const key = `${toolName}:${argsKey}`
      if (seenCalls.has(key)) {
        // Refused, but NOT terminal — a different call may still be useful, and
        // no step is consumed.
        return { allowed: false, reason: 'repeat_call' }
      }

      seenCalls.add(key)
      steps++
      return { allowed: true }
    },

    noteResult(resultHash) {
      if (lastHash !== null && lastHash === resultHash) repeatedResults++
      else repeatedResults = 0
      lastHash = resultHash
    },

    stepsUsed: () => steps,
    reason: () => stop,
  }
}
