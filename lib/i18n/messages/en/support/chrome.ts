import type { Messages } from '../../../translate'

type S = Messages['support']

export const shell: S['shell'] = { back: 'Back to the app', genericName: 'User' }

export const center: S['center'] = {
  title: 'Support centre',
  intro: "Something not working as it should? We're here to help.",
  mine: 'My requests',
  all: 'All requests',
  guides: 'Guides',
  guidesDescription: 'How to use SocialCRM',
}

export const kind: S['kind'] = {
  problem: { tileTitle: 'I have a problem', tileDescription: "Something in SocialCRM isn't working", formTitle: 'What happened?' },
  question: { tileTitle: 'I have a question', tileDescription: 'Help using the app', formTitle: "What's your question?" },
}

export const requests: S['requests'] = {
  intro: 'Your conversations with the SocialCRM team.',
  emptyTitle: "You haven't contacted us yet",
  emptyBody: "If something isn't working as it should, tell us and we'll take care of it.",
}

export const newRequest: S['newRequest'] = {
  title: 'New request',
  intro: "We'll get back to you here in the support centre and by email.",
}

export const form: S['form'] = {
  addMore: 'Anything to add?',
  addMorePlaceholder: 'Anything to add? (optional)',
  placeholder: 'Tell us briefly what happened...',
  sending: 'Sending…',
  send: 'Send request',
  sent: "Your request was sent. We'll get back to you soon.",
}

export const reply: S['reply'] = {
  label: 'Reply',
  reopens: 'Replying will reopen the request.',
  placeholder: 'Write here…',
  send: 'Send reply',
}

export const status: S['status'] = {
  open: 'Opened',
  in_progress: 'In progress',
  waiting_for_customer: 'Waiting for your reply',
  resolved: 'Closed',
}

export const category: S['category'] = {
  leads: 'Leads',
  whatsapp: 'WhatsApp',
  meta: 'Facebook and Instagram',
  automations: 'Automations',
  ai: 'Smart assistant',
  billing: 'Subscription and billing',
  account: 'Account and settings',
  integrations: 'Integrations',
  otherTopic: 'Other',
}

export const author: S['author'] = { self: 'You', support: 'SocialCRM team' }

export const error: S['error'] = {
  forbidden: "You don't have permission for this action",
  not_found: 'The request was not found',
  invalid_subject: 'Please write a short subject for the request',
  invalid_body: 'Please write what happened',
  invalid_category: 'Please choose a topic from the list',
  rate_limited: 'Many requests were sent in a short time. You can try again in an hour.',
  fallback: 'The action failed. Please try again.',
}

export const search: S['search'] = {
  label: 'Looking for an explanation?',
  placeholder: 'Search the guides…',
  searching: 'Searching…',
}

export const guides: S['guides'] = {
  intro: 'Short explanations by topic.',
  emptyTitle: 'No guides found',
  emptyBody: "You can tell us what happened and we'll help.",
  notFound: "Didn't find what you were looking for?",
  notSolved: "Didn't that solve the problem?",
  tellUs: 'Tell us what happened',
}
