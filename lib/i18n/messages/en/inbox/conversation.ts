import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const menu: I['menu'] = {
  label: 'Conversation actions',
  delete: 'Delete conversation',
  confirm:
    'Delete this conversation?\n\nThe conversation and its messages will be deleted from SocialCRM. This will not delete the contact or the lead in the CRM.',
  cancel: 'Cancel',
  deleteFailed: 'Deleting the conversation failed. Try again.',
  deleted: 'Conversation deleted',
}

export const leadless: I['leadless'] = {
  create: '+ Create lead',
  link: 'Link to an existing lead',
  personal: 'Mark as personal',
  quota: "You've reached your lead limit",
  createFailed: "We couldn't create a lead",
  notFound: 'Conversation not found',
  noMatch: 'No lead has this number. You can create a new lead.',
  linkFailed: "We couldn't link to the lead",
  personalFailed: "We couldn't mark it as personal",
  locked: 'Renewing your subscription restores conversation management',
}

export const ownership: I['ownership'] = {
  paused: "Auto-reply is paused: your current plan doesn't include AI replies, so the customer didn't get an automatic answer.",
  pausedLink: 'Details in auto-reply settings',
  handedOff: 'This request was handed to you. Your team takes it from here.',
  humanQuestionnaire: "You're answering this conversation. The questionnaire won't send more messages.",
  human: "You're answering this conversation. The AI agent won't send messages until you hand it back.",
  questionnaire: 'An automatic questionnaire is answering this conversation.',
  agent: 'The AI agent is answering this conversation.',
  awaitingRep: 'Waiting for a rep',
  urgency: 'Urgency: {value}',
  field: {
    name: 'Name',
    businessType: 'Business type',
    need: 'Request',
    urgency: 'Urgency',
  },
  updating: 'Updating…',
  returnQuestionnaire: 'Hand back to the questionnaire',
  returnAgent: 'Hand back to the AI agent',
  takeOver: "I'll answer from here",
  error: {
    opted_out: "The customer asked not to receive messages, so auto-reply won't return to this conversation.",
    closed: "The conversation has ended. Auto-reply won't return to it.",
    forbidden: "You don't have permission to change this.",
    failed: "We couldn't update this. Try again.",
  },
}

export const take: I['take'] = {
  hide: 'Hide',
}

export const analysis: I['analysis'] = {
  title: 'Conversation analysis',
  pending: 'Analyzing the conversation…',
  failed: "The conversation analysis failed. We'll retry automatically when a new message arrives.",
  noSummary: 'No summary available.',
  nextAction: 'Suggested next step: {action}',
  staleNote: 'New messages arrived — the analysis is updating',
  analyzedAt: 'Last analyzed {date}',
  state: {
    fresh: 'Up to date',
    stale: 'Updating',
    failed: 'Failed',
    pending: 'In progress',
  },
}

export const awareness: I['awareness'] = {
  one: 'New message from {name}',
  many: { one: '{count} new message', other: '{count} new messages' },
}
