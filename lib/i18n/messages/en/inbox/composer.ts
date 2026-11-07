import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const draft: I['draft'] = {
  placeholder: 'Write a draft reply...',
  label: 'WhatsApp reply draft',
  emoji: 'Add emoji',
  aiTitle: 'Draft with AI',
  drafting: 'Drafting...',
  copy: 'Copy draft',
  send: 'Send message',
  chars: '{count} / {max} characters',
  draftFailed: "Couldn't draft a reply right now. Try again.",
  copied: 'Draft copied',
  copyFailed: 'Copy failed',
  sent: 'Message sent — awaiting delivery confirmation',
  sendFailed: 'Sending the message failed',
  expired: 'Renewing your subscription restores drafting and sending messages',
}

export const emoji: I['emoji'] = {
  loading: 'Loading emoji…',
  dialog: 'Choose an emoji',
  search: 'Search emoji',
  clear: 'Clear',
  categories: {
    suggested: 'Frequently used',
    smileysPeople: 'Smileys & people',
    animalsNature: 'Animals & nature',
    foodDrink: 'Food & drink',
    travelPlaces: 'Travel & places',
    activities: 'Activities',
    objects: 'Objects',
    symbols: 'Symbols',
    flags: 'Flags',
  },
}

export const serviceWindow: I['serviceWindow'] = {
  closedTitle: 'The WhatsApp messaging window has closed',
  closedBody:
    "More than 24 hours have passed since the customer's last message. To continue the conversation, send an approved ready message.",
  closedCta: 'Choose a ready message',
  closedNoTemplate: 'The messaging window has closed. To continue the conversation, an approved ready message is required.',
  unknown: "A text message can't be sent. The customer hasn't sent a message in this conversation.",
  templatesSettings: 'Go to ready messages',
  native: 'Open the conversation in WhatsApp',
}

export const connect: I['connect'] = {
  lead: 'To send messages,',
  link: 'connect WhatsApp',
  settings: 'Go to connection settings',
}

export const health: I['health'] = {
  reasonsLabel: 'Usually because:',
  not_ready: {
    title: 'WhatsApp number setup is not complete yet',
    explanation: "Until setup is complete, SocialCRM can't receive messages and leads through this connection.",
    reason1: 'The number has not been verified yet',
    reason2: 'Two-step verification is enabled',
    nextStep: 'Complete verification in WhatsApp Manager. If two-step verification is enabled, turn it off temporarily.',
  },
  restricted: {
    title: 'Messages cannot be sent right now',
    explanation: 'WhatsApp is not currently allowing messages from the connected account.',
    nextStep: 'Check the WhatsApp account connected to SocialCRM.',
  },
  expired: {
    title: 'The WhatsApp connection has expired',
    explanation: 'New messages and leads are not coming in right now. All existing data in the system is fully kept.',
    reason1: 'Time has passed since connecting',
    reason2: 'The WhatsApp permission was changed',
    nextStep: 'Renewing the connection takes less than a minute and does not affect existing data.',
  },
  webhook: {
    title: 'The WhatsApp connection is not complete yet',
    explanation: "We couldn't confirm that messages and leads are reaching SocialCRM.",
    nextStep: 'Run the setup again and complete every step until the window closes.',
  },
  throttled: {
    title: 'The connection is fine — status checks are temporarily limited',
    explanation: 'Meta has temporarily limited status checks. Messages and leads keep working as usual.',
    nextStep: "No action is needed. We'll update you when the service is back.",
  },
  needs_verification: {
    title: 'The WhatsApp connection needs to be verified',
    explanation:
      "The connection exists, but we haven't been able to confirm that messages and leads are coming in. Until it is verified, messages may not arrive.",
    nextStep: 'Reconnect to make sure the connection is active.',
  },
}

export const locked: I['locked'] = {
  composer: 'Renewing your subscription restores sending messages',
}

export const optOut: I['optOut'] = {
  title: 'This lead asked to stop receiving WhatsApp messages',
  explanation: 'The request is saved.',
  reasonsLabel: 'What this means:',
  automated: 'Automated WhatsApp messages to this lead are blocked.',
  manual: 'You can still send a manual reply.',
  templates: "Marketing ready messages are blocked, and other ready messages can't be sent to this lead from here either.",
}
