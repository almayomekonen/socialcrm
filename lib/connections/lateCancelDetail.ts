import type { EmbeddedSignupCancel } from '@/lib/facebook/embeddedSignupSession'
import type { EmbeddedSignupStep } from '@/lib/whatsapp/coexistenceEvents'

/**
 * Meta's CANCEL message for a WhatsApp Embedded Signup attempt that has
 * ALREADY ENDED on our side.
 *
 * The launch waits one second after a login callback without a code
 * (`CANCEL_DETAIL_GRACE_MS`). A CANCEL arriving after that is dropped by the gate,
 * so the failure is recorded without Meta's step, error id or session id — which
 * is exactly what production failures have always lacked. After five minutes with
 * no callback (`LAUNCH_TIMEOUT_MS`) the attempt is `pending`: it has no failure
 * event, so a CANCEL arriving then is reported here, in case no callback follows.
 *
 * This tracker attributes such a late CANCEL to the attempt that ended, so its
 * ids can be reported once as a follow-up event. Pure: no I/O, injectable clock.
 *
 * Attribution rules, each one deliberate:
 *   - Only the LATEST attempt is tracked. Starting a new attempt closes the
 *     previous one, so nothing late can be attached to an attempt that is no
 *     longer the most recent.
 *   - While an attempt is live, the gate owns its CANCEL and this returns null.
 *   - Only a FAILED or PENDING attempt accepts late detail; a CANCEL after a success is noise.
 *   - At most one late report per attempt, and only within `LATE_CANCEL_WINDOW_MS`.
 *   - Only ids the attempt's own failure event did not already carry are sent.
 */

/** How long after an attempt ends a CANCEL is still attributed to it. */
export const LATE_CANCEL_WINDOW_MS = 10 * 60_000

/** The parts of a CANCEL that are stored: ids only, never Meta's text. */
export type CancelIds = { step?: EmbeddedSignupStep; metaErrorId?: string; metaSessionId?: string }

export function cancelIds(cancel: EmbeddedSignupCancel | undefined): CancelIds {
  const ids: CancelIds = {}
  if (cancel?.step) ids.step = cancel.step
  if (cancel?.errorId) ids.metaErrorId = cancel.errorId
  if (cancel?.sessionId) ids.metaSessionId = cancel.sessionId
  return ids
}

export type LateCancelReport = { attemptId: string; detail: CancelIds }

export type LateCancelTracker = {
  /** A new attempt starts; any previous attempt stops accepting late detail. */
  begin: (attemptId: string) => void
  /** The attempt ended. `known` is what its own failure event already carried. */
  end: (attemptId: string, outcome: { failed: boolean; known: CancelIds }) => void
  /** No outcome yet, but the gate has stopped being the only record of a CANCEL. */
  pending: (attemptId: string) => void
  /** A CANCEL arrived. Returns what to report for an ended attempt, or null. */
  late: (cancel: EmbeddedSignupCancel) => LateCancelReport | null
}

type Tracked = { id: string; endedAt: number | null; failed: boolean; known: CancelIds; reported: boolean; pending: boolean }

export function createLateCancelTracker(now: () => number = Date.now): LateCancelTracker {
  let current: Tracked | null = null
  return {
    begin(attemptId) {
      current = { id: attemptId, endedAt: null, failed: false, known: {}, reported: false, pending: false }
    },
    end(attemptId, outcome) {
      // A stale end (an older attempt settling after a newer one began) is ignored.
      if (!current || current.id !== attemptId) return
      if (current.endedAt !== null && !current.pending) return
      current.endedAt = now()
      current.pending = false
      current.failed = outcome.failed
      current.known = outcome.known
    },
    pending(attemptId) {
      if (!current || current.id !== attemptId || current.endedAt !== null) return
      current.endedAt = now()
      current.pending = true
      current.failed = true
    },
    late(cancel) {
      const a = current
      if (!a || a.endedAt === null || !a.failed || a.reported) return null
      if (now() - a.endedAt > LATE_CANCEL_WINDOW_MS) return null
      const fresh: CancelIds = {}
      const ids = cancelIds(cancel)
      if (ids.step && !a.known.step) fresh.step = ids.step
      if (ids.metaErrorId && !a.known.metaErrorId) fresh.metaErrorId = ids.metaErrorId
      if (ids.metaSessionId && !a.known.metaSessionId) fresh.metaSessionId = ids.metaSessionId
      if (!fresh.step && !fresh.metaErrorId && !fresh.metaSessionId) return null
      a.reported = true
      return { attemptId: a.id, detail: fresh }
    },
  }
}

/** A random, meaningless id that ties one attempt's events together. */
export function newConnectAttemptId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** What the server accepts as an attempt id: the forms `newConnectAttemptId` makes. */
export const CONNECT_ATTEMPT_ID = /^[A-Za-z0-9-]{8,64}$/
