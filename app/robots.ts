import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/auth/',
          '/clients/',
          '/dashboard/',
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
    sitemap: 'https://getsocialcrm.com/sitemap.xml',
  }
}
