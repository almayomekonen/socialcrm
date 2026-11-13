import { MetadataRoute } from 'next'
import { HOME_LANGUAGES } from '@/lib/seo/metadata'

const BASE_URL = 'https://getsocialcrm.com'

/**
 * Every indexable public route, in the same order as `INDEXABLE_ROUTES` in
 * `__tests__/marketing/routes.ts` — the sitemap test asserts the two agree, so
 * a new route is added in both places or the suite fails.
 *
 * `/en` and `/en/social-crm` are the English pages. The homepage is the only
 * page that exists in both languages, so `/` and `/en` alone carry alternates.
 * `/ar` stays out.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0, alternates: { languages: HOME_LANGUAGES } },
    { url: `${BASE_URL}/en`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9, alternates: { languages: HOME_LANGUAGES } },
    // English-only guide: no Hebrew twin, so no alternates.
    { url: `${BASE_URL}/en/social-crm`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/crm`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/lead-management`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/channels`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/pricing`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/faq`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/instagram-leads-crm`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/crm-for-whatsapp-business`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/facebook-leads`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/crm-vs-excel`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/data-deletion`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ]
}
