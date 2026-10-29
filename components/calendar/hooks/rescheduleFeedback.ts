import type { UpdateMeetingResult } from '@/actions/calendar'

/**
 * What a reschedule gesture (drag = `move`, resize = `resize`) tells the rep
 * after `updateMeeting` answers. Pure: the hook decides when to call it and
 * applies the answer (toast, refresh or revert).
 *
 * `kept`: the CRM row changed (success, or the etag `conflict` — CRM-first, the
 * local write landed before Google refused), so the gesture stays and the grid
 * refreshes. Otherwise the gesture is reverted.
 */

type UpdateResult = UpdateMeetingResult
export type RescheduleKind = 'move' | 'resize'

/** Client-side refusals of the two gestures (before any request). */
export const REFUSAL_COPY = {
  moveMarked: 'לא ניתן להזיז פגישה שכבר סומנה',
  movePast: 'לא ניתן להזיז פגישה לתאריך שעבר',
  resizeMarked: 'לא ניתן לשנות משך פגישה שכבר סומנה',
  tooShort: 'משך הפגישה חייב להיות לפחות 5 דקות',
  busy: 'פגישה אחרת בעיצומה של עדכון. נסה שוב בעוד רגע.',
  unexpected: 'אירעה שגיאה. נסה שוב.',
}

const COPY: Record<RescheduleKind, Record<'synced' | 'notSynced' | 'reauth' | 'syncFailed' | 'conflict' | 'notOwner' | 'failed', string>> = {
  move: {
    synced: 'הפגישה הועברה וסונכרנה ליומן Google',
    notSynced: 'הפגישה הועברה ב-CRM (לא מסונכרנת ליומן Google)',
    reauth: 'הפגישה הועברה ב-CRM. נדרש חיבור מחדש ליומן Google.',
    syncFailed: 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל.',
    conflict: 'הפגישה הועברה ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).',
    notOwner: 'אינך מורשה להעביר פגישה זו',
    failed: 'העברת הפגישה נכשלה',
  },
  resize: {
    synced: 'משך הפגישה עודכן וסונכרן ליומן Google',
    notSynced: 'משך הפגישה עודכן ב-CRM (לא מסונכרנת ליומן Google)',
    reauth: 'משך הפגישה עודכן ב-CRM. נדרש חיבור מחדש ליומן Google.',
    syncFailed: 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל.',
    conflict: 'משך הפגישה עודכן ב-CRM. סנכרון ליומן Google נכשל (נדרש רענון).',
    notOwner: 'אינך מורשה לעדכן פגישה זו',
    failed: 'עדכון משך הפגישה נכשל',
  },
}

export function rescheduleFeedback(
  kind: RescheduleKind,
  result: UpdateResult,
): { tone: 'success' | 'error'; message: string; kept: boolean } {
  const copy = COPY[kind]
  // Pattern note: explicit `=== true` mirrors handleRetry / handleCancel.
  // `if (!result.ok)` doesn't narrow this union reliably here (likely a
  // server-action inference quirk under the current TS config).
  if (result.ok === true) {
    if (result.syncStatus === 'synced') return { tone: 'success', message: copy.synced, kept: true }
    // Meeting has no google_event_id — never reached Google in the first
    // place. Be explicit so the user isn't misled into thinking attendees got
    // an updated invite.
    if (result.syncStatus === 'not_synced') return { tone: 'success', message: copy.notSynced, kept: true }
    if (result.syncStatus === 'reauth_required') return { tone: 'error', message: copy.reauth, kept: true }
    return { tone: 'error', message: copy.syncFailed, kept: true }
  }
  // 'conflict' is the etag-mismatch path: the action wrote CRM BEFORE calling
  // Google, so the change already landed locally. NOTE: with Phase 1's
  // suspended etag enforcement (see actions/calendar.ts) this branch is
  // currently unreachable.
  if (result.reason === 'conflict') return { tone: 'error', message: copy.conflict, kept: true }
  if (result.reason === 'not_owner') return { tone: 'error', message: copy.notOwner, kept: false }
  if (result.reason === 'invalid_input') {
    // Server's invalid_input details: 'duration_too_short' | 'end_before_start'
    // | 'cancelled' | 'startAt' | 'endAt' | 'timezone'.
    const message = result.details === 'duration_too_short' ? REFUSAL_COPY.tooShort : 'הזמנים שהוזנו אינם תקינים'
    return { tone: 'error', message, kept: false }
  }
  return { tone: 'error', message: copy.failed, kept: false }
}
