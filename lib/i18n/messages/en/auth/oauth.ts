import type { Messages } from '../../../translate'

type A = Messages['auth']

export const oauth: A['oauth'] = {
  title: 'Connect an app to SocialCRM',
  heading: 'Connect {client} to SocialCRM',
  signedInAs: 'Signed in as',
  can: '{client} will be able to:',
  scope: {
    leads: 'View your leads, your follow-ups and the daily summary',
    conversations: 'View summaries of WhatsApp conversations with your leads, and the messages themselves on request',
  },
  notGranted:
    '{client} will not receive phone numbers or email addresses, cannot change data and will not send WhatsApp messages.',
  connecting: 'Connecting {client}…',
  cancelling: 'Cancelling…',
  approve: 'Approve connection to {client}',
  back: 'Back to SocialCRM',
  billing: 'Manage subscription',
  message: {
    unavailable: '{client} cannot be connected to this account right now.',
    needsAccess: 'Connecting {client} requires an active subscription or an active trial.',
    notAllowlisted: 'The connection to {client} is not available in your account yet.',
    expired: 'The connection request has expired or was already handled. Go back to the app you started from and try again.',
  },
}

export const root: A['root'] = {
  chunkReloading: 'A new update is loading, refreshing...',
}
