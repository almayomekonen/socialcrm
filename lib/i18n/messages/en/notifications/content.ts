import type { Messages } from '../../../translate'

type C = Messages['notifications']['content']

export const provider: C['provider'] = {
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
}

export const title: C['title'] = {
  leadCreated: 'New lead',
  leadCreatedNamed: 'New lead — {name}',
  leadHot: 'Hot lead',
  leadHotNamed: 'Hot lead — {name}',
  questionnaireComplete: 'Questionnaire completed',
  questionnaireCompleteNamed: 'Questionnaire completed — {name}',
  waitingForRep: 'Waiting for a rep',
  waitingForRepNamed: 'Waiting for a rep — {name}',
  leadAssigned: 'A lead was assigned to you',
  leadAssignedNamed: 'A lead was assigned to you — {name}',
  leadsAssigned: 'Leads were assigned to you',
  leadsAssignedCount: { one: '{count} lead was assigned to you', other: '{count} leads were assigned to you' },
  leadActivity: 'New activity on a lead',
  leadActivityNamed: 'New activity on a lead — {name}',
  insight: 'Worth getting back to this lead',
  insightNamed: 'Worth getting back to this lead — {name}',
  statusChanged: 'Status updated',
  statusChangedNamed: 'Status updated — {name}',
  messageInbound: 'New message',
  messageInboundNamed: 'New message — {name}',
  messagesInbound: { one: '{count} new message', other: '{count} new messages' },
  messagesInboundNamed: { one: '{count} new message — {name}', other: '{count} new messages — {name}' },
  messageUnanswered: 'Message waiting for a reply',
  messageUnansweredNamed: 'Message waiting for a reply — {name}',
  messengerInbound: 'New Messenger message',
  messengerInboundNamed: 'New Messenger message — {name}',
  messengerInboundCount: { one: '{count} new Messenger message', other: '{count} new Messenger messages' },
  messengerInboundCountNamed: {
    one: '{count} new Messenger message — {name}',
    other: '{count} new Messenger messages — {name}',
  },
  comment: 'New comment',
  commentNamed: 'New comment — {name}',
  followupDue: 'Follow-up scheduled for today',
  followupDueNamed: 'Follow-up scheduled for today — {name}',
  followupWaiting: 'Follow-up waiting',
  followupWaitingNamed: 'Follow-up waiting — {name}',
  disconnected: 'Connection lost',
  disconnectedProvider: 'The {provider} connection was lost',
  connectionError: 'Connection problem',
  connectionErrorProvider: 'Problem with the {provider} connection',
  leadNotSaved: 'Lead not saved',
  cancellation: 'Subscription cancellation needs handling',
  reminderFailed: 'Reminder not sent',
  reminderUnconfirmed: 'Reminder delivery could not be confirmed',
}

export const body: C['body'] = {
  insight: 'Something is worth checking. Open the lead for details.',
  reconnect: 'Reconnect it in Settings',
  leadNotSaved: 'A lead arrived that was not saved in the system',
  leadNotSavedProvider: 'A lead arrived from {provider} that was not saved in the system',
  cancellation: 'A business cancelled its SocialCRM subscription. Cancel its standing order in Grow.',
  cancellationNamed: '{agency} cancelled its SocialCRM subscription. Cancel its standing order in Grow.',
  reminderFailed: 'We could not send you the WhatsApp reminder you asked for.',
  reminderFailedAt: 'We could not send you the WhatsApp reminder scheduled for {when}.',
  reminderUnconfirmed: 'We could not confirm that the reminder you asked for reached you on WhatsApp. It may have arrived, so it will not be sent again automatically.',
  reminderUnconfirmedAt: 'We could not confirm that the reminder scheduled for {when} reached you on WhatsApp. It may have arrived, so it will not be sent again automatically.',
}
