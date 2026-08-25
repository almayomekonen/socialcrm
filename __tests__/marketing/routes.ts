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
  /** Directory under `app/(marketing)/`; `null` for the group's own page.tsx. */
  dir: string | null
  /** False for pages intentionally kept out of the index (e.g. /thank-you). */
  indexable: boolean
  /**
   * Canonical this route declares. Every route now canonicalises to itself:
   * the Lumen homepage lives at `/`, and `/crm` is a 308 to it (next.config),
   * not a second page.
   */
  canonical: string
}

export const SITE_URL = 'https://getsocialcrm.com'

export const MARKETING_ROUTES: MarketingRoute[] = [
  { path: '/', dir: null, indexable: true, canonical: `${SITE_URL}/` },
  { path: '/channels', dir: 'channels', indexable: true, canonical: `${SITE_URL}/channels` },
  { path: '/pricing', dir: 'pricing', indexable: true, canonical: `${SITE_URL}/pricing` },
  { path: '/faq', dir: 'faq', indexable: true, canonical: `${SITE_URL}/faq` },
  // Acquisition pages: entered from search, not from the nav. They are listed
  // here so metadata/heading/structured-data/sitemap coverage applies to them.
  { path: '/instagram-leads-crm', dir: 'instagram-leads-crm', indexable: true, canonical: `${SITE_URL}/instagram-leads-crm` },
  { path: '/crm-for-whatsapp-business', dir: 'crm-for-whatsapp-business', indexable: true, canonical: `${SITE_URL}/crm-for-whatsapp-business` },
  { path: '/crm-vs-excel', dir: 'crm-vs-excel', indexable: true, canonical: `${SITE_URL}/crm-vs-excel` },
  { path: '/privacy', dir: 'privacy', indexable: true, canonical: `${SITE_URL}/privacy` },
  { path: '/terms', dir: 'terms', indexable: true, canonical: `${SITE_URL}/terms` },
  { path: '/data-deletion', dir: 'data-deletion', indexable: true, canonical: `${SITE_URL}/data-deletion` },
  { path: '/thank-you', dir: 'thank-you', indexable: false, canonical: `${SITE_URL}/thank-you` },
]

/** Routes that must appear in `app/sitemap.ts`, in the order they are listed. */
export const INDEXABLE_ROUTES = MARKETING_ROUTES.filter((r) => r.indexable)
