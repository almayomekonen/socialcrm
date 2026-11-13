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
