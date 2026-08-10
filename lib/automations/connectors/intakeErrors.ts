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
  consecutiveRejections: number
  lastRejectedAt: string | null
  lastEventAt: string | null
  lastRejectionReason: string | null
}

/**
 * Is this connection failing to take leads in, badly enough to say so?
 *
 * Three conditions, and each earns its place:
 *
 *  1. THE REASON IS ONE WE CAN EXPLAIN. A refusal with no customer copy is one
 *     the customer cannot act on, so raising it would be noise.
 *
 *  2. THE STREAK IS AT THE HOUSE THRESHOLD. Reuses `shouldShowSyncBanner` —
 *     the same "three consecutive failures before a banner" decision the CRM
 *     poller already makes. A single blip is not an incident.
 *
 *  3. NOTHING HAS BEEN DELIVERED SINCE. This is the false-positive guard,
 *     stated explicitly even though the reset in `recordDelivery` already
 *     implies it. The endpoint is public; a stranger posting garbage at a
 *     working connection must never make it look broken, and the interleaved
 *     case (valid, invalid, valid, invalid) must stay silent — which it does,
 *     because every valid delivery zeroes the streak.
 */
export function isFailingIntake(facts: RejectionFacts): boolean {
  if (!isCustomerFacingRejection(facts.lastRejectionReason)) return false
  if (!shouldShowSyncBanner(facts.consecutiveRejections)) return false
  if (!facts.lastRejectedAt) return false
  // Never delivered at all, or the last refusal is newer than the last delivery.
  if (!facts.lastEventAt) return true
  return Date.parse(facts.lastRejectedAt) > Date.parse(facts.lastEventAt)
}
