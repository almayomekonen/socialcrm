import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const metaNotice: I['metaNotice'] = {
  prompt: {
    authorize: 'Approve permission',
    adminOnly: 'The account admin needs to approve the permission on Facebook.',
    redirecting: 'Redirecting to Facebook...',
  },
  messenger_permission: {
    title: 'Approve a permission to receive and send Messenger messages',
    explanation:
      'Your Page is connected and leads keep arriving as usual. For Messenger messages from the Page to appear here and for you to reply to them, Facebook requires approval to manage the Page messages.',
    nextStep: "Approve the permission on Facebook's screen. Your connection and existing leads won't be affected.",
    action: 'Approve Messenger permission',
  },
  messenger_declined: {
    title: "The Messenger permission wasn't approved",
    explanation: "The permission to manage messages wasn't selected on Facebook's approval screen, so Messenger messages won't arrive here.",
    reason1: "The permission wasn't selected on Facebook's approval screen",
    nextStep: 'You can try again and select the permission.',
    action: 'Try again',
  },
  messenger_not_subscribed: {
    title: "Messenger messages aren't arriving here yet",
    explanation: "Facebook isn't sending the Page's Messenger messages to SocialCRM yet, so new messages won't appear here.",
    nextStep: "Reconnect the Page on Facebook. Your connection and existing leads won't be affected.",
    action: 'Reconnect the Page to Messenger',
  },
  expired: {
    title: 'The Facebook connection has expired',
    explanation: 'New leads are not coming in right now. All existing data in the system is fully preserved.',
    reason1: 'About 60 days have passed since connecting',
    reason2: 'The Facebook password was changed',
    nextStep: "Renewing the connection takes less than a minute and doesn't affect existing data.",
    action: 'Reconnect',
  },
  comment_replies_permission: {
    title: 'Approve a permission to reply to comments from here',
    explanation:
      'Comments keep arriving as usual. To post a reply as the Page directly from SocialCRM, Facebook requires approval to manage comments on the Page.',
    nextStep: "Approve the permission on Facebook's screen. Your connection and existing leads won't be affected.",
    action: 'Approve permission to reply to comments',
  },
  comment_replies_declined: {
    title: "The permission to reply to comments wasn't approved",
    explanation: "The permission to manage comments wasn't selected on Facebook's approval screen, so replies can't be posted from here.",
    reason1: "The permission wasn't selected on Facebook's approval screen",
    nextStep: 'You can try again and select the permission. Meanwhile, you can reply directly on Facebook.',
    action: 'Try again',
  },
  in_app_browser: {
    title: 'Open the site in a browser',
    explanation: "Inside Instagram, Meta's sign-in window doesn't always open or return to the app.",
    nextStep: 'Open getsocialcrm.com in Safari or Chrome, sign in and try again.',
    action: 'Try anyway',
  },
}
