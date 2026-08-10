import { SYNC_FAILURE_THRESHOLD, shouldShowSyncBanner } from '@/lib/polling/syncFailure'
import type { IngestRejection } from './ingest'

/**
 * LEAD-INTAKE FAILURES, in the customer's terms.
 *
 * A refused webhook is not an automation failure — the engine is never reached,
 * so there is no job and no activity row. It is a LEAD INTAKE failure, and this
 * module is the only place the technical reason is translated into something a
 * customer can act on.
 *
 * Pure: no I/O, no React. Two component trees consume it — the connections card
 * and the leads banner — which is why the copy lives here rather than in either
 * one's local `copy.ts`. One map, so the two surfaces can never disagree about
 * what happened.
 */

export type IntakeErrorCopy = {
  /** Names the SOURCE, never the mechanism. */
  title: string
  /** What was attempted, what failed, and what was lost. */
  explanation: string
  /** Short form for a banner, where the title already carries the subject. */
  short: string
  /** Present ONLY when a real destination exists. */
  action?: { label: string; href: string }
}

/**
 * PARTIAL by design, and the partiality is the point.
 *
 * `IngestRejection` has six values and three of them return HTTP 200 because
 * they are decisions, not errors — "the provider sent something we do not act
 * on" is not a problem a customer can or should fix. A total `Record` would
 * force copy to be invented for reasons that must never reach anyone, so an
 * unmapped reason is deliberately silent — the same discipline as the `null`
 * entries in `LAW_EVALUATORS`.
 *
 * `subject_unresolved` is intentionally absent: a submission with no
 * identifiable lead is a real failure, but a DIFFERENT one, and calling it a
 * connection problem would send the customer to the wrong screen.
 */
export const INTAKE_ERRORS: Partial<Record<IngestRejection, IntakeErrorCopy>> = {
  invalid_signature: {
    title: 'יש בעיה בחיבור לטופס באתר',
    explanation: 'התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת ולכן הליד לא נכנס למערכת.',
    short: 'פניות מהטופס מגיעות אבל לא נכנסות למערכת.',
    action: { label: 'בדיקת החיבור', href: '/settings/integrations?section=website' },
  },
  unreadable_payload: {
    title: 'יש בעיה בחיבור לטופס באתר',
    explanation: 'התקבלה פנייה מהטופס באתר שלך במבנה שלא הצלחנו לקרוא, ולכן הליד לא נכנס למערכת.',
    short: 'פניות מהטופס מגיעות במבנה שאינו נקרא.',
    action: { label: 'בדיקת החיבור', href: '/settings/integrations?section=website' },
  },
}

/** Whether a refusal is one the customer can be told about at all. */
export function isCustomerFacingRejection(reason: string | null | undefined): reason is IngestRejection {
  return Boolean(reason && reason in INTAKE_ERRORS)
}

export function intakeErrorCopy(reason: string | null | undefined): IntakeErrorCopy | null {
  return isCustomerFacingRejection(reason) ? (INTAKE_ERRORS[reason] ?? null) : null
}

/** The house threshold, re-exported so callers never hardcode a second one. */
export { SYNC_FAILURE_THRESHOLD }

export type RejectionFacts = {
  /** Verified deliveries ever. Non-zero means the wiring is PROVEN to have worked. */
  eventCount: number
  consecutiveRejections: number
  lastRejectedAt: string | null
  lastEventAt: string | null
  lastRejectionReason: string | null
}

/**
 * Is this connection failing to take leads in, badly enough to say so?
 *
 * Two gates every refusal must pass, then a threshold that depends on whether
 * the connection has ever worked.
 *
 *  1. THE REASON IS ONE WE CAN EXPLAIN. A refusal with no customer copy is one
 *     the customer cannot act on, so raising it would be noise.
 *
 *  2. NOTHING HAS BEEN DELIVERED SINCE. The false-positive guard, stated
 *     explicitly even though the reset in `recordDelivery` already implies it.
 *     One verified delivery is enough to clear the alarm — proving the wiring
 *     works is exactly as strong as proving it broke, so recovery is immediate
 *     and never asks for a streak of successes.
 *
 * Then the evidence bar, and it is deliberately NOT the same on both sides:
 *
 *  · PROVEN CONNECTION (`eventCount > 0`) — ONE refusal is enough. A connection
 *    that has delivered successfully and suddenly cannot verify its signature is
 *    a configuration REGRESSION, not noise: a stranger posting at a public URL
 *    has never had a valid signature, so it could never have produced those
 *    deliveries. Requiring a streak here would price the alarm in lost leads —
 *    three real people would have to fill in the form and vanish before anyone
 *    was told. Production connection #3 was exactly this case: 57 deliveries, one
 *    `invalid_signature`, and the card still read "מקבל אירועים".
 *
 *  · UNPROVEN CONNECTION (`eventCount === 0`) — the house threshold applies.
 *    Nothing has ever arrived, so a refusal carries no evidence that anything is
 *    configured at all, and accusing a brand-new connection of being broken on
 *    one arbitrary public request is the false positive worth avoiding.
 *
 * The asymmetry IS the fix. The bug it replaces had it backwards: three refusals
 * to raise an alarm, but a single `eventCount` from any point in history to keep
 * claiming "receiving".
 */
export function isFailingIntake(facts: RejectionFacts): boolean {
  if (!isCustomerFacingRejection(facts.lastRejectionReason)) return false
  if (!facts.lastRejectedAt) return false

  // A delivery at or after the refusal supersedes it — the connection recovered.
  if (facts.lastEventAt && Date.parse(facts.lastEventAt) >= Date.parse(facts.lastRejectedAt)) return false

  if (facts.eventCount > 0) return true
  return shouldShowSyncBanner(facts.consecutiveRejections)
}
