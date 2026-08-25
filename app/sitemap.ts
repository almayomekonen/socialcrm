import { MetadataRoute } from 'next'

const BASE_URL = 'https://getsocialcrm.com'

/**
 * Every indexable public route, in the same order as `INDEXABLE_ROUTES` in
 * `__tests__/marketing/routes.ts` — the sitemap test asserts the two agree, so
 * a new route is added in both places or the suite fails.
 *
 * The three acquisition pages sit deliberately outside the primary navigation:
 * search is their only entry point, so being listed here is what makes them
 * discoverable at all.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${BASE_URL}/channels`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/faq`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/instagram-leads-crm`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/crm-for-whatsapp-business`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/crm-vs-excel`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/data-deletion`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ]
}
