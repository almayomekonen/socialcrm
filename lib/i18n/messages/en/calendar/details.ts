import type { Messages } from '../../../translate'

type L = Messages['calendar']

export const details: L['details'] = {
  time: 'Time',
  lead: 'Lead',
  viewLead: 'View lead →',
  syncError: 'Failure details: ',
  openMeet: 'Open Google Meet',
  marking: 'Marking…',
  markCompleted: 'Mark as completed',
  markNoShow: 'Mark as no-show',
  close: 'Close',
  retrying: 'Syncing…',
  retry: 'Try syncing again',
  edit: 'Edit meeting',
  cancelling: 'Cancelling…',
  cancel: 'Cancel meeting',
  cancelConfirm: 'Cancel the meeting "{title}"?\nAttendees will receive a cancellation notice.',
}

export const outcome: L['outcome'] = {
  completed: 'Marked as completed',
  noShow: 'Marked as no-show',
  failed: 'Updating the meeting failed',
  unexpected: 'Something went wrong. Try again.',
  leadUpdated: 'Lead status updated',
  leadUpdateFailed: 'Updating the lead failed',
  error: {
    invalid_input: 'Invalid input',
    not_found: 'The meeting was not found',
    not_owner: 'You are not allowed to update this meeting',
    already_cancelled: 'The meeting was already cancelled',
    already_completed: 'The meeting is already marked as completed',
    already_no_show: 'The meeting is already marked as a no-show',
  },
  nudge: 'You marked the meeting as completed. We recommend updating the lead status to',
  notNow: 'Not now',
  updating: 'Updating…',
  apply: 'Update status to {status}',
}

export const badge: L['badge'] = {
  sync: { pending: 'Syncing…', synced: 'Synced', failed: 'Sync failed', reauth_required: 'Reconnect needed' },
  outcome: { completed: 'Completed', no_show: 'No-show', cancelled: 'Cancelled' },
}
