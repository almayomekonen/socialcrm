import type { FAQItem } from '@/components/seo/FAQ'

/**
 * One Hebrew SEO landing page, as data. `LandingPage` renders it with the
 * same hero, prose, FAQ and closing CTA the existing landing pages use, so a
 * page file only states its metadata and content.
 *
 * Content rules (CLAUDE.md, care-charter Law 1): every product claim must be
 * true for every account today. Features behind an agency allowlist
 * (automations, WhatsApp templates, the WhatsApp assistant, Messenger, AI
 * beyond the existing approved sentence) are not promised.
 */
export interface LandingLink {
  href: string
  label: string
  /** Set when the target is in another language (the English guide). */
  hrefLang?: string
}

export interface LandingSection {
  h2: string
  paragraphs: readonly string[]
  bullets?: readonly string[]
  links?: readonly LandingLink[]
}

export interface LandingPageContent {
  path: string
  title: string
  description: string
  ogTitle: string
  /** Path under /public of this page's own 1200×630 Open Graph image. */
  ogImage: string
  breadcrumb: string
  badge: string
  h1: readonly [string, string]
  /** The opening paragraphs. The primary keyword appears in the first one. */
  intro: readonly string[]
  sections: readonly LandingSection[]
  faqTitle: string
  faq: { general: readonly FAQItem[]; setup: readonly FAQItem[] }
  ctaTitle: string
  ctaHighlight: string
}

/**
 * Every landing page, with the descriptive anchor text other pages use to link
 * to it. Each page lists the others in its body ("related").
 */
export const LANDING_LINKS: readonly LandingLink[] = [
  { href: '/crm', label: 'מדריך: מה זה מערכת CRM ואיך בוחרים' },
  { href: '/lead-management', label: 'מערכת לניהול לידים: מהפנייה ועד הסגירה' },
  { href: '/whatsapp-crm', label: 'CRM לוואטסאפ: כל שיחה הופכת לליד' },
  { href: '/facebook-leads', label: 'חיבור לידים מפייסבוק ל-CRM' },
  { href: '/instagram-leads', label: 'לידים מאינסטגרם ל-CRM' },
  { href: '/en/social-crm', label: 'What is social CRM? (English)', hrefLang: 'en' },
]

/**
 * The trial terms, next to every landing-page CTA. The trial needs a saved card
 * and nothing is charged in the first seven days (lib/trial, lib/pricing).
 */
export const TRIAL_TERMS_LINE = '7 ימים ללא חיוב. נדרש כרטיס אשראי.'
