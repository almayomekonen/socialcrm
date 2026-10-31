import type { Messages } from '../../../translate'

type T = Messages['trial']

export const welcome: T['welcome'] = {
  title: {
    setup: 'Start with a 7-day trial',
    awaiting: "Your card is saved, and we're verifying it",
    unavailable: "You can't start right now",
    later: 'Your trial will open here soon',
    start: 'Start with SocialCRM Pro',
  },
  sub: {
    setup: 'The trial starts only after your card is verified. Nothing is charged today.',
    awaiting: 'The trial starts as soon as verification is done, and nothing was charged.',
    unavailable: "The payment system is temporarily unavailable, so the trial hasn't opened yet. Nothing was charged.",
    later: "We're finishing the payment connection. Your account is saved, nothing was charged, and you don't need to do anything.",
    start: 'Next step: get your leads into the system.',
  },
  tail: {
    awaiting: 'Verification usually takes a few seconds. You can refresh the page.',
    unavailable: "You can try again later, or contact us and we'll sort it out.",
    later: "We'll let you know as soon as you can start.",
  },
  submitCard: 'Add a card and start the trial',
  adminOnly: 'Only the account admin can start the trial.',
  start: 'Start my Pro',
  starting: 'Just a moment...',
  startNote: '7 days free · no credit card · cancel anytime',
  error: 'Something went wrong, please try again',
  networkError: 'A network error occurred, please try again',
}

export const expired: T['expired'] = {
  title: 'Your workspace is waiting for you',
  titleLeads: 'Your leads are waiting',
  body: 'Your leads and data are saved exactly as you left them. To keep working, upgrade.',
  reactivation: {
    declined: "We couldn't charge the card you saved. Your leads and data are saved exactly as you left them. To continue, confirm a payment method.",
    cancelled: 'You cancelled the subscription renewal. Your leads and data are saved exactly as you left them, and you can continue at any time.',
    ended: 'Your leads and data are saved exactly as you left them. To continue, confirm a payment method.',
  },
  waiting: { one: '{count} lead is waiting for you to get back to it', other: '{count} leads are waiting for you to get back to them' },
  perMonth: '/month',
  benefits: {
    ai: 'Unlimited AI in fast mode and smart mode',
    history: 'Full AI history for every lead',
    drafting: 'Message drafting, recommendations and next steps',
  },
  updateCard: 'Update payment method and continue',
  upgrade: 'Upgrade now',
  note: 'No commitment · cancel anytime · all your data is kept',
  leadFallback: 'Lead',
}

export const celebration: T['celebration'] = {
  title: 'Your Pro is active',
  sub: 'Every SocialCRM Pro capability is open to you for the next 7 days.',
  benefits: {
    ai: 'Advanced AI',
    leads: 'All leads and conversations',
    tools: 'Every work tool and integration',
  },
  cta: 'Start working with Pro',
}
