import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const summary: L['summary'] = {
  nextFollowUp: 'Next follow-up: {date}',
  noFollowUp: 'No follow-up scheduled',
  lastInteraction: 'Last interaction: {outcome}',
}

export const outcome: L['outcome'] = {
  call_no_answer: 'No answer',
  call_reached: 'We talked',
  call_interested: 'Interested',
  call_not_interested: 'Not interested',
  meeting_completed: 'Meeting completed',
  meeting_no_show: 'Missed the meeting',
}

export const followUp: L['followUp'] = {
  tomorrow: 'Tomorrow',
  in3Days: 'In 3 days',
  inWeek: 'In a week',
  otherDate: 'Another date…',
  remove: 'Remove follow-up',
  set: 'Schedule follow-up',
  current: 'Follow-up: {date}',
  toastSet: 'Follow-up scheduled for {date}',
  toastCleared: 'Follow-up removed',
  expired: 'Renewing your subscription brings back scheduling follow-ups',
}

export const firstLead: L['firstLead'] = {
  title: 'Your first lead is in',
  body: 'Choose when to get back to them, and SocialCRM will bring them back to you on time.',
  done: 'Great. Your lead is in progress.',
  backToLeads: 'Back to leads',
  dismiss: 'Close',
}

export const tasks: L['tasks'] = {
  title: 'Tasks',
  all: 'All tasks',
}

export const activity: L['activity'] = {
  title: 'Notes and calls',
  empty: 'No notes on this lead yet. Write down what was said on the call, so you can pick up exactly where you left off.',
  placeholder: 'What was said on the call? What did you agree with the lead?',
  add: 'Add note',
  saving: 'Saving…',
  delete: 'Delete note',
  confirmDelete: 'Delete this note? It cannot be restored.',
  errors: {
    empty: 'Enter the note text',
    tooLong: 'This note is too long. Shorten it and try again.',
    notFound: 'The lead or note was not found. Refresh the page and try again.',
  },
}

export const readyMessage: L['readyMessage'] = {
  open: 'Send a ready message',
  title: 'Send a ready message',
  intro: 'Choose an approved message — it will be sent to the lead on WhatsApp.',
  legend: 'Ready-to-send WhatsApp messages',
  preview: 'Preview',
  previewEmpty: 'Choose a message to see a preview',
  sending: 'Sending…',
  send: 'Send message',
  sent: 'Message sent',
  proTitle: 'Sending messages is available with Pro',
  proBody: 'Renewing your subscription brings back sending messages to leads.',
}
