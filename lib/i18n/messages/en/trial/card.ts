import type { Messages } from '../../../translate'

type T = Messages['trial']

export const verifier: T['verifier'] = {
  pageTitle: 'Card saved',
  headline: {
    card_trial: 'Your trial has started',
    card_update: 'Your card was updated',
    reactivate: 'Your subscription was renewed',
  },
  sandbox: 'Sandbox payment test — no real transaction was made and no real card was saved.',
  chargeOn: 'Your card is saved. The first charge, ₪{amount}, will be made on {date}. You can cancel before then on the subscription page.',
  chargeOff: 'Your card is saved. The trial ends on {date}; automatic charging is not active right now, so no payment will be taken on that date.',
  saved: 'Your details were saved. You can continue working.',
  enter: 'Go to the app',
  failedTitle: "We couldn't verify the card",
  failedBody: 'Nothing was charged. You can try again with the same card or a different one.',
  toBilling: 'Go to the subscription page',
  timedOutTitle: 'The confirmation is still being checked',
  timedOutCallback: "We received the card details and we're verifying them with Grow. Nothing has been charged yet.",
  timedOutNoCallback: "We haven't received confirmation from the payment company yet. Nothing has been charged yet.",
  timedOutNote: "There's no need to wait here — we'll email you as soon as verification is done, and the status is always shown on the subscription page.",
  back: 'Back to the app',
  verifyingTitle: "Just a moment, we're verifying with the payment company",
  verifyingBody:
    "Your card is saved on Grow's side and we're confirming it. Nothing is charged for the subscription at this stage; a temporary ₪1 hold may be placed for verification; according to Grow it is released within up to 10 days.",
}

export const holder: T['holder'] = {
  fullName: 'Enter a first and last name, in letters only',
  phone: 'Enter a valid Israeli mobile number, for example 0501234567',
}
