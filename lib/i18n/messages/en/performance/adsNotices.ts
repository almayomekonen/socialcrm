import type { Messages } from '../../../translate'

export const adsNotices: Messages['performance']['adsNotices'] = {
  connect: {
    title: 'Connect your ad account to see performance',
    explanation: 'To show your campaigns’ spend, impressions and clicks here, Facebook requires permission to read your ad data (read-only, no changes to campaigns).',
    nextStep: 'Approve the permission on the Facebook screen and choose the ad accounts.',
    action: 'Connect ad account',
  },
  connectFailed: {
    title: 'The ad account connection was not completed',
    explanation: 'You came back from Facebook, but we could not complete and save the connection. No connection was saved and no data was read.',
    reason1: 'The Facebook approval screen stayed open for more than 10 minutes',
    reason2: 'A temporary problem at Facebook or on our side',
    nextStep: 'Connect again.',
    action: 'Connect again',
  },
  declined: {
    title: 'Permission to read ad data was not granted',
    explanation: 'The permission was not ticked on the Facebook approval screen, so no connection was saved and no data was read.',
    nextStep: 'You can try again and tick the permission.',
    action: 'Try again',
  },
  expired: {
    title: 'The ad account connection expired',
    explanation: 'Access to the ad data expired or was revoked in Facebook. No data was deleted.',
    nextStep: 'Reconnect to keep seeing performance.',
    action: 'Reconnect',
  },
  noAccounts: {
    title: 'No ad accounts found',
    explanation: 'The connection worked, but Facebook did not return any ad account the connected user may view.',
    reason1: 'No ad account was chosen on the approval screen',
    reason2: 'The user has no permission for the ad account in Business Manager',
    nextStep: 'Reconnect and choose the ad account, or ask for access to the account.',
    action: 'Reconnect and choose an account',
  },
  permission: {
    title: 'No access to this ad account’s data',
    explanation: 'Facebook refused to read the selected account’s performance. This is a permission problem — not a lack of activity.',
    reason1: 'The permission for the account was removed',
    reason2: 'Access to the account in Business Manager changed',
    nextStep: 'Reconnect and make sure the ad account is selected and you have access to it.',
    action: 'Reconnect',
  },
  rateLimited: {
    title: 'Facebook is limiting the request rate right now',
    explanation: 'The data did not load because the ad account reached Facebook’s request limit.',
    nextStep: 'Try again in a few minutes.',
    action: 'Try again',
  },
  metaError: {
    title: 'We could not load the ad data',
    explanation: 'Facebook did not return a valid answer. This does not mean there is no activity.',
    nextStep: 'Try again in a moment.',
    action: 'Try again',
  },
  noActivity: {
    title: 'No activity in this range',
    explanation:
      'Meta returned no performance data for this account in the selected date range — there was no spend or impressions in it. This does not mean the account did not advertise in other periods.',
    nextStep: 'You can choose another date range (for example a custom range) or another ad account.',
  },
  invalidRange: {
    title: 'The date range is not valid',
    explanation: 'The selected range is not valid or exceeds the 37 months Facebook allows, so the last 30 days are shown.',
  },
}
