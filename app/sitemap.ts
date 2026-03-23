import { MetadataRoute } from 'next'

const BASE_URL = 'https://socialcrm.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    // Primary entry points
    { url: `${BASE_URL}/auth`, lastModified: new Date(), changeFrequency: 'monthly', priority: 1.0 },
    { url: `${BASE_URL}/auth/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.9 },

    // Pillar page
    { url: `${BASE_URL}/crm`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.95 },

    // Cluster pages
    { url: `${BASE_URL}/features`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/facebook-leads`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.85 },
    { url: `${BASE_URL}/whatsapp-leads`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/crm-vs-excel`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  ]
}
