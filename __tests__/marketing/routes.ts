/**
 * The marketing route table — the single list the guardrail suite works from.
 *
 * Adding a public marketing route means adding it HERE. Every test in
 * `__tests__/marketing/` iterates this table, so a route that is not listed is
 * a route with no metadata, heading, structured-data or sitemap coverage. The
 * sitemap test asserts this table and `app/sitemap.ts` agree, which is what
 * stops the two drifting apart.
 */

export interface MarketingRoute {
  /** URL path as it appears in the sitemap and in canonicals. */
  path: string
  /** Directory under `app/(he)/(marketing)/`; `null` for the group's own page.tsx. */
  dir: string | null
  /** False for pages intentionally kept out of the index (e.g. /thank-you). */
  indexable: boolean
  /**
   * Canonical this route declares. Every route canonicalises to itself.
   */
  canonical: string
}

export const SITE_URL = 'https://getsocialcrm.com'

export const MARKETING_ROUTES: MarketingRoute[] = [
  { path: '/', dir: null, indexable: true, canonical: `${SITE_URL}/` },
  { path: '/channels', dir: 'channels', indexable: true, canonical: `${SITE_URL}/channels` },
  { path: '/pricing', dir: 'pricing', indexable: true, canonical: `${SITE_URL}/pricing` },
  { path: '/faq', dir: 'faq', indexable: true, canonical: `${SITE_URL}/faq` },
  // Landing pages (current design): reached from the footer and from each
  // other. Listed so metadata/heading/structured-data/sitemap coverage applies.
  { path: '/crm', dir: 'crm', indexable: true, canonical: `${SITE_URL}/crm` },
  { path: '/lead-management', dir: 'lead-management', indexable: true, canonical: `${SITE_URL}/lead-management` },
  { path: '/whatsapp-crm', dir: 'whatsapp-crm', indexable: true, canonical: `${SITE_URL}/whatsapp-crm` },
  { path: '/facebook-leads', dir: 'facebook-leads', indexable: true, canonical: `${SITE_URL}/facebook-leads` },
  { path: '/instagram-leads', dir: 'instagram-leads', indexable: true, canonical: `${SITE_URL}/instagram-leads` },
  { path: '/privacy', dir: 'privacy', indexable: true, canonical: `${SITE_URL}/privacy` },
  { path: '/terms', dir: 'terms', indexable: true, canonical: `${SITE_URL}/terms` },
  { path: '/data-deletion', dir: 'data-deletion', indexable: true, canonical: `${SITE_URL}/data-deletion` },
  { path: '/thank-you', dir: 'thank-you', indexable: false, canonical: `${SITE_URL}/thank-you` },
]

/**
 * The one indexable page outside the Hebrew tree. Kept apart from the table,
 * whose routes all live under `app/(he)/(marketing)`.
 */
export const ENGLISH_HOME_PATH = '/en'

/** The English social CRM guide: English-only, no Hebrew twin, linked from nowhere on /en. */
export const ENGLISH_GUIDE_PATH = '/en/social-crm'

/** Routes that must appear in `app/sitemap.ts`, in the order they are listed. */
export const INDEXABLE_ROUTES = MARKETING_ROUTES.filter((r) => r.indexable)
