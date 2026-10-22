import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { clientConnectFailureReason } from '@/lib/connections/connectFailure'
import {
  browserStorage,
  clearPendingAttempt,
  markPendingAttempt,
  takeAbandonedAttempt,
} from '@/lib/connections/pendingConnectAttempt'
import type { EmbeddedSignupResult } from '@/lib/facebook/useEmbeddedSignup'
import type { EmbeddedSignupCancel } from '@/lib/facebook/embeddedSignupSession'
import { cancelIds, createLateCancelTracker, newConnectAttemptId } from '@/lib/connections/lateCancelDetail'

/**
 * The outcome side of one WhatsApp connect attempt, kept out of
 * `useEmbeddedSignup` so the hook stays about launching Meta's flow.
 *
 * Every attempt ends in exactly one of: the result reported by `finish`, or —
 * when the page did not survive the attempt — `abandoned` on the next visit.
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

/**
 * Call synchronously in the click handler, before launching. Only synchronous
 * work happens here, so FB.login still runs inside the click task.
 */
export function beginConnectAttempt(): { finish: (result: EmbeddedSignupResult) => EmbeddedSignupResult } {
  const startedAt = Date.now()
  // Random and meaningless: it only ties a later cancel-detail event to this failure.
  const attemptId = newConnectAttemptId()
  lateCancels.begin(attemptId)
  const storage = browserStorage()
  if (storage) markPendingAttempt(storage, startedAt)
  liveAttempts += 1

  return {
    finish(result) {
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
