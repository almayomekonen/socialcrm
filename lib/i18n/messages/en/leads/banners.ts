import type { Messages } from '../../../translate'

type L = Messages['leads']

export const banners: L['banners'] = {
  metaDisconnected: "Your Meta account is disconnected. New leads won't come in until you reconnect it.",
  reconnect: 'Reconnect',
  overQuota: {
    one: 'You have {count} new lead waiting — upgrade to see it',
    other: 'You have {count} new leads waiting — upgrade to see them',
  },
  upgradeNow: 'Upgrade now',
  syncProblem: 'Connection problem. Retrying',
  retry: 'Try again',
}

export const intake: L['intake'] = {
  invalid_signature: {
    title: "There's a problem with your website form connection",
    explanation:
      "Your website form tried to send a lead, but the connection couldn't be verified, so the lead didn't enter the system.",
    short: "Form submissions arrive but don't enter the system.",
  },
  unreadable_payload: {
    title: "There's a problem with your website form connection",
    explanation:
      "A submission from your website form arrived in a format we couldn't read, so the lead didn't enter the system.",
    short: "Form submissions arrive in a format that can't be read.",
  },
}

export const quota: L['quota'] = {
  title: 'Lead limit',
  bulk: 'The file has {attempted} leads; only {remaining} remain in the free plan.',
  single: "You've already managed {limit} leads here.",
  bulkHint: 'Upgrade to import all of them and continue without limits.',
  singleHint: "Don't stop now — continue without limits.",
  plan: 'Pro · ₪{price} / month',
  unlimited: 'Unlimited leads',
  later: 'Later',
}
