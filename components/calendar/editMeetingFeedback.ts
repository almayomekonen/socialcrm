import type { UpdateMeetingResult } from '@/actions/calendar'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * What the edit dialog does with `updateMeeting`'s answer, chosen from the
 * result CODE only. `saved`: the CRM row changed (success, or the etag
 * conflict — CRM-first), so the dialog toasts, refreshes the grid and closes.
 * Otherwise it stays open with an inline error. Extracted from
 * MeetingEditDialog (over the 250-line soft limit, architecture-rules §1);
 * same branches in the same order.
 */
export type EditFeedback =
  | { saved: true; tone: 'success' | 'error'; message: MessageKey }
  | { saved: false; message: MessageKey }

export function editMeetingFeedback(result: UpdateMeetingResult): EditFeedback {
  if (result.ok === true) {
    if (result.syncStatus === 'synced') return { saved: true, tone: 'success', message: 'calendar.form.edit.synced' }
    if (result.syncStatus === 'not_synced') return { saved: true, tone: 'success', message: 'calendar.form.edit.notSynced' }
    if (result.syncStatus === 'reauth_required') return { saved: true, tone: 'error', message: 'calendar.form.edit.reauth' }
    return { saved: true, tone: 'error', message: 'calendar.form.edit.syncFailed' }
  }
  if (result.reason === 'conflict') return { saved: true, tone: 'error', message: 'calendar.form.edit.conflict' }
  if (result.reason === 'not_owner') return { saved: false, message: 'calendar.form.edit.notOwner' }
  if (result.reason === 'not_found') return { saved: false, message: 'calendar.form.edit.notFound' }
  // invalid_input with various `details`.
  if (result.details === 'duration_too_short') return { saved: false, message: 'calendar.form.edit.tooShort' }
  if (result.details === 'end_before_start') return { saved: false, message: 'calendar.form.invalid.endBeforeStart' }
  if (result.details === 'cancelled') return { saved: false, message: 'calendar.form.edit.cancelled' }
  return { saved: false, message: 'calendar.form.edit.failed' }
}
