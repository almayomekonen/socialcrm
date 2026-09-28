import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { clientConnectFailureReason } from '@/lib/connections/connectFailure'
import {
  browserStorage,
  clearPendingAttempt,
  markPendingAttempt,
  takeAbandonedAttempt,
} from '@/lib/connections/pendingConnectAttempt'
import type { EmbeddedSignupResult } from '@/lib/facebook/useEmbeddedSignup'

/**
 * The outcome side of one WhatsApp connect attempt, kept out of
 * `useEmbeddedSignup` so the hook stays about launching Meta's flow.
 *
 * Every attempt ends in exactly one of: the result reported by `finish`, or —
 * when the page did not survive the attempt — `abandoned` on the next visit.
 * All reporting is fire and forget; analytics must never affect the flow.
 */

/**
 * Call synchronously in the click handler, before launching. Only synchronous
 * work happens here, so FB.login still runs inside the click task.
 */
export function beginConnectAttempt(): { finish: (result: EmbeddedSignupResult) => EmbeddedSignupResult } {
  const startedAt = Date.now()
  const storage = browserStorage()
  if (storage) markPendingAttempt(storage, startedAt)

  return {
    finish(result) {
      if (storage) clearPendingAttempt(storage)
      const reason = clientConnectFailureReason(result)
      if (reason) {
        void recordLeadActionEvent('whatsapp_connect_failed', {
          reason,
          step: result.cancel?.step,
          metaErrorId: result.cancel?.errorId,
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
  const storage = browserStorage()
  const abandoned = storage && takeAbandonedAttempt(storage, Date.now())
  if (abandoned) {
    void recordLeadActionEvent('whatsapp_connect_failed', { reason: 'abandoned', elapsedMs: abandoned.sinceStartMs })
  }
}
