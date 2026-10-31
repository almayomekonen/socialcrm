/**
 * The welcome modal's copy, one headline and one sentence per state (moved out
 * of WelcomeTrialModal.tsx, i18n Phase F5).
 */
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * ONE headline and ONE sentence per state, in a single table.
 *
 * The defect this replaces: a fixed header — "SocialCRM Pro פתוח לכם ל־7 ימים"
 * over "ללא עלות · ללא כרטיס אשראי" — rendered above whichever body applied,
 * so an account with no billing path read that Pro was open to it, that no card
 * was needed, and then that the trial had not opened yet. Three claims, two of
 * them false, on the one screen a new customer cannot dismiss.
 *
 * Keeping the copy beside the state it belongs to is what stops a state from
 * inheriting another's promise. Nothing here says a trial is running: the trial
 * begins when Grow's callback is verified, never when this modal renders.
 */
export type View = 'setup' | 'awaiting' | 'unavailable' | 'later' | 'start'

/**
 * The headline / sentence / closing line of each state, by key (i18n Phase F5).
 * The words live in `trial.welcome.*` (Hebrew: the table that stood here,
 * verbatim). The `start` state is click-to-start with no card: unreachable while
 * hasBillingPath() and the card variant share one flag, but it is a real no-card
 * path, so it is the one state where "ללא כרטיס אשראי" is true and keeps saying so.
 */
const TITLE: Record<View, MessageKey> = {
  setup: 'trial.welcome.title.setup',
  awaiting: 'trial.welcome.title.awaiting',
  unavailable: 'trial.welcome.title.unavailable',
  later: 'trial.welcome.title.later',
  start: 'trial.welcome.title.start',
}
const SUB: Record<View, MessageKey> = {
  setup: 'trial.welcome.sub.setup',
  awaiting: 'trial.welcome.sub.awaiting',
  unavailable: 'trial.welcome.sub.unavailable',
  later: 'trial.welcome.sub.later',
  start: 'trial.welcome.sub.start',
}
const TAIL: Record<'awaiting' | 'unavailable' | 'later', MessageKey> = {
  awaiting: 'trial.welcome.tail.awaiting',
  unavailable: 'trial.welcome.tail.unavailable',
  later: 'trial.welcome.tail.later',
}

export function copyKeys(view: View): { title: MessageKey; sub: MessageKey } {
  return { title: TITLE[view], sub: SUB[view] }
}

/** A closing line for the states that have no action to offer. */
export function tailKey(view: 'awaiting' | 'unavailable' | 'later'): MessageKey {
  return TAIL[view]
}
