import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const mobile: I['mobile'] = {
  thread: {
    openLead: 'Open the lead {name}',
    missingBody: 'It may have been deleted, or you may not have access to it.',
    empty: 'No messages in this conversation yet.',
    composerLabel: 'Write a message',
    composerPlaceholder: 'Write a message...',
    send: 'Send',
    actions: 'Message actions',
    copy: 'Copy',
    copied: 'Message copied',
    copyFailed: "We couldn't copy the message",
  },
  send: {
    noConnection: 'There is no active WhatsApp connection. You can connect it in the integrations settings.',
    noRecipient: 'This lead has no valid WhatsApp number.',
    leadNotFound: 'Lead not found.',
    leadless: "You can't send a message from a conversation without a lead.",
    sendFailed: "WhatsApp didn't accept the message. Try again in a moment.",
    persistFailed: "The message was sent but wasn't saved to the conversation. Refresh the screen.",
    tooLong: 'The message is too long.',
    invalidInput: "The message can't be sent.",
    empty: "You can't send an empty message.",
    generic: "We couldn't send the message. Try again.",
  },
  list: {
    you: 'You:',
    noMessages: 'No messages yet',
    loadMore: 'Load more conversations',
    searchPlaceholder: 'Search conversations',
    count: { one: '{count} conversation', other: '{count} conversations' },
    deleteFailed: "The conversations couldn't be deleted. Try again.",
    deletePartial: "Some conversations weren't deleted. Try again.",
    markReadFailed: "We couldn't mark them as read. Try again.",
  },
  selection: {
    markRead: 'Mark as read',
    delete: 'Delete',
    confirmTitle: 'Delete conversations',
    confirmBody: {
      one: "Delete one conversation?\nDeleted conversations can't be restored.",
      other: "Delete {count} conversations?\nDeleted conversations can't be restored.",
    },
    confirm: { one: 'Delete conversation', other: 'Delete conversations' },
  },
  empty: {
    noResultsBody: 'No results for "{q}".',
    noneTitle: 'No conversations yet',
    noneBody: 'When a customer sends a WhatsApp message, the conversation will appear here.',
    settings: 'WhatsApp settings',
  },
  time: {
    now: 'Just now',
  },
  readyTitle: {
    lead_first_contact: 'First contact',
    follow_up: 'Follow-up',
    ready_message: 'Ready message',
  },
}
