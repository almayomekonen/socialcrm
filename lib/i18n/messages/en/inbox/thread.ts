import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const header: I['header'] = {
  title: 'WhatsApp conversation',
  lastActivity: 'Last activity {date}',
  needsReply: 'Needs a reply',
  repReplied: 'The rep replied last',
  call: 'Call',
  leadCard: 'Lead profile',
}

export const conversation: I['conversation'] = {
  emptyTitle: 'No WhatsApp messages yet',
  emptyLead: 'When the lead writes, the messages will appear here.',
  emptyContact: 'When a message arrives, it will appear here.',
  messages: 'Conversation messages',
  inbound: 'Incoming message',
  outbound: 'Message sent from the system',
  newMessage: 'New WhatsApp message received',
}

export const status: I['status'] = {
  sent: 'Sent — awaiting delivery confirmation',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
}

export const failure: I['failure'] = {
  window_expired: 'The message was not sent — more than 24 hours have passed since the lead wrote. You can call them.',
  recipient: 'The message was not sent — this number is not active on WhatsApp.',
  account: 'The message was not sent — messaging is currently disabled. Check the account settings.',
  generic: 'The message was not sent. Try again.',
}

export const tooltip: I['tooltip'] = {
  window_expired: {
    title: 'The message cannot be sent',
    explanation: "WhatsApp only allows a regular message up to 24 hours after the customer's last message.",
    action: 'To reach them now, you can call them.',
  },
  recipient: {
    title: 'The message cannot be sent',
    explanation: 'This number does not seem to be available on WhatsApp.',
    action: 'Check that the number is correct, or contact the customer another way.',
  },
  account: {
    title: 'Messages cannot be sent right now',
    explanation: 'WhatsApp is not currently allowing messages from the connected account.',
    action: 'Check the WhatsApp account connected to SocialCRM.',
  },
  generic: {
    title: 'The message was not sent',
    explanation: 'WhatsApp could not send the message.',
    action: 'You can try again in a few moments.',
  },
}

export const reaction: I['reaction'] = {
  list: 'Reactions to the message',
  sent: 'Reaction sent',
  received: 'Reaction received',
  onEarlier: 'on an earlier message',
}

export const quote: I['quote'] = {
  label: 'Quote',
  notFound: 'Reply to an earlier message',
}

export const kind: I['kind'] = {
  image: 'Photo',
  video: 'Video',
  document: 'Document',
  audio: 'Voice message',
  sticker: 'Sticker',
  location: 'Location',
  contacts: 'Contact',
  message: 'Message',
}

export const media: I['media'] = {
  unsupported: 'This message type is not supported yet',
  unnamedFile: 'File from WhatsApp',
  unnamedAudio: 'Recording from WhatsApp',
  kindImage: 'Image',
  kindAudio: 'Recording',
  kindVideo: 'Video',
  imageAlt: 'Photo received on WhatsApp',
  showImage: 'View the photo {name}',
  openFile: 'Open the file {name}',
  open: 'Open',
  play: 'Play recording',
  pause: 'Pause recording',
  seek: 'Position in the recording',
  viewer: 'Photo viewer',
}
