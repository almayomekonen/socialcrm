import type { UpdateMeetingResult } from '@/actions/calendar'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * What a reschedule gesture (drag = `move`, resize = `resize`) tells the rep
 * after `updateMeeting` answers. Pure: the hook decides when to call it and
 * applies the answer (toast, refresh or revert). The copy is a catalog KEY
 * (`calendar.reschedule.*`), chosen from the result CODE only.
 *
 * `kept`: the CRM row changed (success, or the etag `conflict` — CRM-first, the
 * local write landed before Google refused), so the gesture stays and the grid
 * refreshes. Otherwise the gesture is reverted.
 */

export type RescheduleKind = 'move' | 'resize'

/** Client-side refusals of the two gestures (before any request); `unexpected` is the shared retry line. */
export const REFUSAL_KEY = {
  moveMarked: 'calendar.reschedule.moveMarked',
  movePast: 'calendar.reschedule.movePast',
  resizeMarked: 'calendar.reschedule.resizeMarked',
  tooShort: 'calendar.reschedule.tooShort',
  busy: 'calendar.reschedule.busy',
  unexpected: 'calendar.form.unexpected',
} as const satisfies Record<string, MessageKey>

type Outcome = 'synced' | 'notSynced' | 'reauth' | 'syncFailed' | 'conflict' | 'notOwner' | 'failed'
const KEYS: Record<RescheduleKind, Record<Outcome, MessageKey>> = {
  move: {
    synced: 'calendar.reschedule.move.synced',
    notSynced: 'calendar.reschedule.move.notSynced',
    reauth: 'calendar.reschedule.move.reauth',
    syncFailed: 'calendar.reschedule.move.syncFailed',
    conflict: 'calendar.reschedule.move.conflict',
    notOwner: 'calendar.reschedule.move.notOwner',
    failed: 'calendar.reschedule.move.failed',
  },
  resize: {
    synced: 'calendar.reschedule.resize.synced',
    notSynced: 'calendar.reschedule.resize.notSynced',
    reauth: 'calendar.reschedule.resize.reauth',
    syncFailed: 'calendar.reschedule.resize.syncFailed',
    conflict: 'calendar.reschedule.resize.conflict',
    notOwner: 'calendar.reschedule.resize.notOwner',
    failed: 'calendar.reschedule.resize.failed',
  },
}
const key = (kind: RescheduleKind, outcome: Outcome) => KEYS[kind][outcome]

export function rescheduleFeedback(
  kind: RescheduleKind,
  result: UpdateMeetingResult,
): { tone: 'success' | 'error'; message: MessageKey; kept: boolean } {
  // Pattern note: explicit `=== true` mirrors handleRetry / handleCancel.
  // `if (!result.ok)` doesn't narrow this union reliably here (likely a
  // server-action inference quirk under the current TS config).
  if (result.ok === true) {
    if (result.syncStatus === 'synced') return { tone: 'success', message: key(kind, 'synced'), kept: true }
    // Meeting has no google_event_id — never reached Google in the first
    // place. Be explicit so the user isn't misled into thinking attendees got
    // an updated invite.
    if (result.syncStatus === 'not_synced') return { tone: 'success', message: key(kind, 'notSynced'), kept: true }
    if (result.syncStatus === 'reauth_required') return { tone: 'error', message: key(kind, 'reauth'), kept: true }
    return { tone: 'error', message: key(kind, 'syncFailed'), kept: true }
  }
  // 'conflict' is the etag-mismatch path: the action wrote CRM BEFORE calling
  // Google, so the change already landed locally. NOTE: with Phase 1's
  // suspended etag enforcement (see actions/calendar.ts) this branch is
  // currently unreachable.
  if (result.reason === 'conflict') return { tone: 'error', message: key(kind, 'conflict'), kept: true }
  if (result.reason === 'not_owner') return { tone: 'error', message: key(kind, 'notOwner'), kept: false }
  if (result.reason === 'invalid_input') {
    // Server's invalid_input details: 'duration_too_short' | 'end_before_start'
    // | 'cancelled' | 'startAt' | 'endAt' | 'timezone'.
    const message = result.details === 'duration_too_short' ? REFUSAL_KEY.tooShort : 'calendar.reschedule.invalidTimes'
    return { tone: 'error', message, kept: false }
  }
  return { tone: 'error', message: key(kind, 'failed'), kept: false }
}
