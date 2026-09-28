import { PRICING } from './pricing'

/**
 * What each plan includes — the single source of the inclusion copy.
 *
 * Extracted from components/settings/payment/Packages.tsx (a 'use client'
 * module) so Server Components can read it without pulling a client boundary
 * in. The billing centre's "מה כלול במסלול Pro" disclosure and the Packages
 * cards now render the same list; there is no second copy to drift.
 */

export type Pkg = {
  id: 'pro'
  name: string
  pricePerMonth: number
  tagline: string
  included: string[]
}

/**
 * NO FREE TIER IS OFFERED HERE, BECAUSE THERE IS NONE TO FALL BACK TO.
 *
 * This surface used to show a "Free" card promising "לידים ללא הגבלה" and
 * "ה-CRM כולו חינמי לתמיד". Neither survives contact with what an expired
 * account actually gets:
 *
 *   · Access. app/(app)/layout.tsx renders WorkspaceTeaser INSTEAD of the
 *     workspace and its page children once trialStatus is TRIAL_EXPIRED — the
 *     CRM is never streamed to an account without access, and
 *     requireProductAccess enforces the same server-side. There is no free
 *     workspace to land in.
 *   · Leads. Even where the free plan does apply, assertLeadQuota caps visible
 *     leads at FREE_LEAD_LIMIT (50) — the opposite of unlimited.
 *
 * The one population with free-tier access is LEGACY (trialExempt)
 * grandfathered agencies, which is not what a customer finishing a trial
 * becomes. Advertising Free to them was an offer the product does not keep.
 *
 * Limits and entitlements are deliberately unchanged: this removes a claim,
 * not a capability.
 */
export const packages: Pkg[] = [
  {
    id: 'pro',
    name: 'Pro',
    pricePerMonth: PRICING.monthly,
    tagline: 'שכבת ה-AI שמלווה את כל ה-CRM שלך.',
    included: [
      'AI ללא הגבלה במצב מהיר ובמצב חכם',
      'מצב AI מתקדם לניתוח מעמיק',
      'היסטוריית AI מלאה לכל ליד',
      'ניסוח הודעות, המלצות וצעדים הבאים',
      'תכונות AI עתידיות בלי תוספת תשלום',
    ],
  },
]

/** The Pro inclusion list, for surfaces that only ever describe Pro. */
export const PRO_INCLUDED: string[] = packages.find((p) => p.id === 'pro')!.included
