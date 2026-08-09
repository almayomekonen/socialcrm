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
  id: 'free' | 'pro'
  name: string
  pricePerMonth: number
  tagline: string
  included: string[]
}

export const packages: Pkg[] = [
  {
    id: 'free',
    name: 'Free',
    pricePerMonth: 0,
    tagline: 'ה-CRM כולו חינמי לתמיד.',
    included: [
      'לידים ללא הגבלה',
      'משתמשים ללא הגבלה',
      'חיבור פייסבוק, אינסטגרם ו-וואטסאפ',
      'ייבוא לידים מאקסל',
      '10 פעולות AI בחודש במצב מהיר',
    ],
  },
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
