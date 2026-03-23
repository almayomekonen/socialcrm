import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/auth', '/auth/register', '/features', '/facebook-leads'],
        disallow: [
          '/clients/',
          '/leads/',
          '/tasks/',
          '/settings/',
          '/sum_sales/',
          '/api/',
          '/files/',
          '/promotion/',
          '/thank-you',
        ],
      },
    ],
    sitemap: 'https://socialcrm.vercel.app/sitemap.xml',
    host: 'https://socialcrm.vercel.app',
  }
}
