import type { ActivationStatus, ActivationContext } from '@/lib/activation/activationState'

export type ScreenCopy = {
  progressLabel?: string
  heading: string
  body?: string
  ctaLabel?: string
  ctaLoadingLabel?: string
  trust?: string[]
  instruction?: string
  secondary?: string
}

const TRUST = ['חיבור מאובטח דרך Meta', 'הגישה ללידים שלך בלבד', 'המידע שלך נשאר שלך']

// The mobile handoff copy that used to live here moved to
// lib/activation/mobileHandoffCopy.ts when the mobile experience became its own
// server-gated surface. It also stated "הלידים שלך נכנסים אוטומטית", which
// stopped being true for every user once onboarding no longer required an
// integration — the new copy claims nothing about the account.

export function copyFor(status: ActivationStatus, _ctx: ActivationContext): ScreenCopy {
  switch (status) {
    case 'waitingForActivation':
      return {
        progressLabel: 'שלב 2 מתוך 2',
        heading: 'עם סיום השלב הזה, כל ליד חדש יגיע לכאן אוטומטית.',
        ctaLabel: 'התחל לקבל לידים',
        ctaLoadingLabel: 'מתחבר…',
        trust: TRUST,
      }
    case 'oauthPending':
      return { heading: 'מסיים את החיבור…' }
    case 'selectingPage':
      return {
        progressLabel: 'שלב 2 מתוך 2',
        heading: 'איזה דף לחבר?',
        ctaLabel: 'התחל לקבל לידים',
        ctaLoadingLabel: 'מחבר…',
      }
    case 'subscribingPage':
      return { heading: 'מחבר את מקור הלידים שלך…' }
    case 'activationCompleted':
      return {
        progressLabel: 'הושלם',
        heading: 'סביבת העבודה שלך מוכנה.',
        body: 'מעכשיו, כל ליד חדש יגיע לכאן אוטומטית.',
        instruction: 'המשך במחשב לחוויה המלאה.',
        ctaLabel: 'העתק קישור לכניסה מהמחשב',
        secondary: 'כבר ליד המחשב? היכנס ל-getsocialcrm.com',
      }
    case 'failed':
      return {
        heading: 'החיבור לא הושלם.',
        body: 'אפשר לנסות שוב כדי לקבל לידים אוטומטית.',
        ctaLabel: 'נסה שוב',
        ctaLoadingLabel: 'מתחבר…',
      }
    default:
      return { heading: '' }
  }
}
