import type { Messages } from '../../../translate'

type L = Messages['calendar']

export const page: L['page'] = {
  title: 'Meetings',
  heading: 'Meetings',
  newMeeting: 'New meeting',
  loading: 'Loading calendar…',
  notConnected: {
    title: 'Connect your calendar',
    body: 'Connect your Google account to manage meetings with leads, create Meet links automatically and sync with Google Calendar.',
    cta: 'Connect calendar',
  },
  reauth: {
    title: 'Your Google Calendar connection has expired',
    body: 'New meetings will not sync until you reconnect.',
    cta: 'Reconnect',
  },
  grid: { today: 'Today', month: 'Month', week: 'Week', day: 'Day' },
}

export const pro: L['pro'] = {
  create: { title: 'Creating meetings is available with Pro', body: 'Renewing your subscription brings back scheduling meetings.' },
  move: { title: 'Editing meetings is available with Pro', body: 'Renewing your subscription brings back editing meetings.' },
  retry: { title: 'Calendar sync is available with Pro', body: 'Renewing your subscription brings back syncing with Google Calendar.' },
  cancel: { title: 'Cancelling meetings is available with Pro', body: 'Renewing your subscription brings back cancelling meetings.' },
  outcome: { title: 'Updating meeting outcomes is available with Pro', body: 'Renewing your subscription brings back updating outcomes.' },
}

export const reschedule: L['reschedule'] = {
  moveMarked: 'A meeting that is already marked cannot be moved',
  movePast: 'A meeting cannot be moved to a past date',
  resizeMarked: 'The length of a meeting that is already marked cannot be changed',
  tooShort: 'A meeting must be at least 5 minutes long',
  busy: 'Another meeting is being updated. Try again in a moment.',
  invalidTimes: 'The times entered are not valid',
  move: {
    synced: 'Meeting moved and synced to Google Calendar',
    notSynced: 'Meeting moved in the CRM (not synced to Google Calendar)',
    reauth: 'Meeting moved in the CRM. Reconnect Google Calendar.',
    syncFailed: 'Meeting moved in the CRM. Syncing to Google Calendar failed.',
    conflict: 'Meeting moved in the CRM. Syncing to Google Calendar failed (refresh needed).',
    notOwner: 'You are not allowed to move this meeting',
    failed: 'Moving the meeting failed',
  },
  resize: {
    synced: 'Meeting length updated and synced to Google Calendar',
    notSynced: 'Meeting length updated in the CRM (not synced to Google Calendar)',
    reauth: 'Meeting length updated in the CRM. Reconnect Google Calendar.',
    syncFailed: 'Meeting length updated in the CRM. Syncing to Google Calendar failed.',
    conflict: 'Meeting length updated in the CRM. Syncing to Google Calendar failed (refresh needed).',
    notOwner: 'You are not allowed to update this meeting',
    failed: 'Updating the meeting length failed',
  },
}

export const sync: L['sync'] = {
  retried: 'Meeting synced',
  retryReauth: 'Reconnect your calendar',
  retryFailed: 'Sync failed',
  cancelled: 'Meeting cancelled',
  cancelReauth: 'Meeting cancelled in the CRM. Reconnect your calendar.',
  cancelGoogleFailed: 'Meeting cancelled in the CRM. Deleting it from Google Calendar failed.',
  cancelFailed: 'Cancelling the meeting failed',
}
