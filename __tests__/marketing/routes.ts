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
   * Canonical this route declares. Usually its own URL; `/crm` deliberately
   * points at `/` because `app/(marketing)/page.tsx` re-exports it.
   */
  canonical: string
}

export const SITE_URL = 'https://getsocialcrm.com'

export const MARKETING_ROUTES: MarketingRoute[] = [
  { path: '/', dir: null, indexable: true, canonical: `${SITE_URL}/` },
  { path: '/crm', dir: 'crm', indexable: true, canonical: `${SITE_URL}/` },
  { path: '/features', dir: 'features', indexable: true, canonical: `${SITE_URL}/features` },
  { path: '/facebook-leads', dir: 'facebook-leads', indexable: true, canonical: `${SITE_URL}/facebook-leads` },
  { path: '/whatsapp-leads', dir: 'whatsapp-leads', indexable: true, canonical: `${SITE_URL}/whatsapp-leads` },
  { path: '/crm-vs-excel', dir: 'crm-vs-excel', indexable: true, canonical: `${SITE_URL}/crm-vs-excel` },
  { path: '/crm-for-whatsapp-business', dir: 'crm-for-whatsapp-business', indexable: true, canonical: `${SITE_URL}/crm-for-whatsapp-business` },
  { path: '/instagram-leads-crm', dir: 'instagram-leads-crm', indexable: true, canonical: `${SITE_URL}/instagram-leads-crm` },
  { path: '/pricing', dir: 'pricing', indexable: true, canonical: `${SITE_URL}/pricing` },
  { path: '/privacy', dir: 'privacy', indexable: true, canonical: `${SITE_URL}/privacy` },
  { path: '/terms', dir: 'terms', indexable: true, canonical: `${SITE_URL}/terms` },
  { path: '/data-deletion', dir: 'data-deletion', indexable: true, canonical: `${SITE_URL}/data-deletion` },
  { path: '/thank-you', dir: 'thank-you', indexable: false, canonical: `${SITE_URL}/thank-you` },
]

/** Routes that must appear in `app/sitemap.ts`, in the order they are listed. */
export const INDEXABLE_ROUTES = MARKETING_ROUTES.filter((r) => r.indexable)
