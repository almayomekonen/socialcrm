import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { clientConnectFailureReason } from '@/lib/connections/connectFailure'
import {
  browserStorage,
  clearPendingAttempt,
  markPendingAttempt,
  takeAbandonedAttempt,
} from '@/lib/connections/pendingConnectAttempt'
import type { EmbeddedSignupResult } from '@/lib/facebook/useEmbeddedSignup'
import type { EmbeddedSignupCancel, EmbeddedSignupMessageShape } from '@/lib/facebook/embeddedSignupSession'
import { storableMetaErrorText } from '@/lib/whatsapp/coexistenceEvents'
import { cancelIds, createLateCancelTracker, newConnectAttemptId } from '@/lib/connections/lateCancelDetail'

/**
 * The outcome side of one WhatsApp connect attempt, kept out of
 * `useEmbeddedSignup` so the hook stays about launching Meta's flow.
 *
 * Every attempt ends in exactly one of: the result reported by `finish`, or —
 * when the page did not survive the attempt — `abandoned` on the next visit. One
 * still open after five minutes is reported as `whatsapp_connect_pending` first,
 * and keeps its marker and its live count until it really ends. A retry replaces
 * it, and it then stays unknown: nothing later can say how it would have ended.
 * All reporting is fire and forget; analytics must never affect the flow.
 *
 * `abandoned` is reported only when no attempt is live in this page: a second
 * connect surface mounting mid-attempt shares this module, sees the live count,
 * and leaves the marker alone. A reload resets the count, so a marker found
 * then really belongs to an attempt the page did not survive. The server still
 * drops it if the attempt reached an outcome (recordLeadActionEvent).
 */

let liveAttempts = 0
// One per page, shared by every connect surface, so a late CANCEL is reported once.
const lateCancels = createLateCancelTracker()
let currentAttemptId: string | null = null
let replacePendingAttempt: (() => void) | null = null
// The same Meta message can arrive twice; each is stored once per attempt.
let reportedMetaEvents = new Set<string>()

/**
 * Call synchronously in the click handler, before launching. Only synchronous
 * work happens here, so FB.login still runs inside the click task.
 */
export function beginConnectAttempt(): {
  attemptId: string
  pending: () => void
  finish: (result: EmbeddedSignupResult) => EmbeddedSignupResult
} {
  replacePendingAttempt?.()
  const startedAt = Date.now()
  // Random and meaningless: it only ties a later cancel-detail event to this failure.
  const attemptId = newConnectAttemptId()
  lateCancels.begin(attemptId)
  currentAttemptId = attemptId
  reportedMetaEvents = new Set()
  const storage = browserStorage()
  if (storage) markPendingAttempt(storage, startedAt)
  liveAttempts += 1
  let replaced = false

  return {
    attemptId,
    pending() {
      replacePendingAttempt = () => {
        replaced = true
        replacePendingAttempt = null
        liveAttempts = Math.max(0, liveAttempts - 1)
      }
      lateCancels.pending(attemptId)
      void recordLeadActionEvent('whatsapp_connect_pending', { attemptId, elapsedMs: Date.now() - startedAt })
    },
    finish(result) {
      // Replaced by a retry: its marker and outcome now belong to the new attempt.
      if (replaced) return result
      replacePendingAttempt = null
      liveAttempts = Math.max(0, liveAttempts - 1)
      if (storage) clearPendingAttempt(storage)
      const reason = clientConnectFailureReason(result)
      // Late detail only for an attempt whose failure event carries this attempt id.
      lateCancels.end(attemptId, { failed: reason !== null, known: cancelIds(result.cancel) })
      if (reason) {
        void recordLeadActionEvent('whatsapp_connect_failed', {
          reason,
          step: result.cancel?.step,
          metaErrorId: result.cancel?.errorId,
          metaSessionId: result.cancel?.sessionId,
          attemptId,
          // Click to outcome: tells a window that never opened from one a person closed.
          elapsedMs: Date.now() - startedAt,
        })
      }
      return result
    },
  }
}

/** On mount: report an attempt a reload or navigation left without an outcome. */
export function reportAbandonedConnectAttempt(): void {
  if (liveAttempts > 0) return
  const storage = browserStorage()
  const abandoned = storage && takeAbandonedAttempt(storage, Date.now())
  if (abandoned) {
    void recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: abandoned.sinceStartMs })
  }
}

/**
 * Meta's CANCEL message, seen by the page's listener. While an attempt is live
 * the gate owns it; for an attempt that already ended (see lateCancelDetail.ts)
 * its ids are reported once, as their own event, with the failure's attempt id.
 */
export function reportLateCancel(cancel: EmbeddedSignupCancel): void {
  const late = lateCancels.late(cancel)
  if (late) void recordLeadActionEvent('whatsapp_connect_cancel_detail', { attemptId: late.attemptId, ...late.detail })
}

/**
 * One message from Meta's window, reported as it arrives. A failure event only
 * exists if the attempt reaches an outcome in this page; this does not depend on
 * that, so Meta's error code and session id survive a window left open or a page
 * that went away. Tied to the latest attempt; dropped if this page started none.
 */
export function reportMetaEvent(shape: EmbeddedSignupMessageShape, cancel: EmbeddedSignupCancel | null): void {
  if (!currentAttemptId) return
  const detail = {
    attemptId: currentAttemptId,
    ...shape,
    ...(cancel ? cancelIds(cancel) : {}),
    metaTraceId: cancel?.traceId,
    metaTimestamp: cancel?.timestamp,
    metaErrorMessage: storableMetaErrorText(cancel?.errorMessage),
  }
  const key = JSON.stringify(detail)
  if (reportedMetaEvents.has(key)) return
  reportedMetaEvents.add(key)
  void recordLeadActionEvent('whatsapp_connect_meta_event', detail)
}
