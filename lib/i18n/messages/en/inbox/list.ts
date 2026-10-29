import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const page: I['page'] = {
  title: 'Conversations',
  conversation: 'Conversation',
  unsupportedChannel: '{channel} conversations are not supported here yet.',
  loading: 'Loading…',
}

export const toolbar: I['toolbar'] = {
  status: {
    label: 'Status',
    all: 'All',
    open: 'Open',
    closed: 'Closed',
    archived: 'Archived',
  },
  sort: {
    label: 'Sort',
    latest: 'Latest activity',
    oldest: 'Oldest activity',
    unread: 'Unread first',
    temperature: 'Hot leads first',
    intent: 'By lead intent',
    action: 'By suggested step',
  },
  intel: {
    label: 'Smart filter',
    all: 'All conversations',
    hot: 'Hot leads',
    attention: 'Needs immediate attention',
    pricing: 'Pricing requests',
    demo: 'Demo requests',
    support: 'Service requests',
    escalation: 'Service escalations',
    followup: 'Needs follow-up',
  },
  smart: {
    hot: 'Hot conversations',
    attention: 'Needs immediate attention',
    demo: 'Demo opportunities',
    escalation: 'Service escalations',
  },
  searchPlaceholder: 'Search name, phone or message',
  searchLabel: 'Search conversations',
  unread: 'Unread',
  needsReply: 'Awaiting reply',
}

export const channels: I['channels'] = {
  label: 'Channel',
  whatsapp: 'Conversations',
  facebook: 'Comments',
  messengerUnread: { one: '{count} unread conversation', other: '{count} unread conversations' },
}

export const list: I['list'] = {
  empty: 'No conversations found',
  loadMore: 'Load more',
  loadingMore: 'Loading...',
}

export const row: I['row'] = {
  fallbackName: 'Conversation',
  avatarFallback: 'L',
  sentPrefix: 'Sent:',
  nextStep: 'Next step: {action}',
  unread: 'Unread',
}

export const empty: I['empty'] = {
  pickTitle: 'Select a conversation from the list to get started',
  pickBody: 'Messages, analysis and the suggested next step will appear here.',
  noneTitle: 'No WhatsApp conversations yet',
  noneBody: 'When a lead writes on WhatsApp, the conversation will appear here automatically.',
}

export const intel: I['intel'] = {
  intent: {
    pricing: 'Interested in pricing',
    demo: 'Requesting a demo',
    signup: 'Wants to sign up',
    support: 'Service request',
    followup: 'Follow-up',
    information: 'Requesting information',
  },
  temperature: {
    hot: 'Hot lead',
    warm: 'Warm lead',
    cold: 'Cold lead',
  },
  action: {
    send_quote: 'Send a quote',
    schedule_demo: 'Schedule a demo',
    follow_up: 'Send a follow-up message',
    answer_question: "Answer the lead's question",
    close_lead: 'Move toward closing',
    escalate_support: 'Hand off to service',
  },
  confidence: {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Low confidence',
  },
}
