import '@/lib/css/main.css'
import LayoutPageEvents from '@/lib/hooksNEvents'
import ToastMsg from '@/lib/toast'
import { metaData } from '@/types/vars'
import { Assistant } from 'next/font/google'

const font = Assistant({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-assistant',
})

export const metadata = metaData

const schemaOrg = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://socialcrm.vercel.app/#organization',
      name: 'SocialCRM',
      url: 'https://socialcrm.vercel.app',
      logo: {
        '@type': 'ImageObject',
        url: 'https://socialcrm.vercel.app/media/logo.svg',
        width: 200,
        height: 60,
      },
      description: 'מערכת ניהול לידים ומכירות לעסקים קטנים בישראל',
      inLanguage: 'he',
      areaServed: 'IL',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://socialcrm.vercel.app/#software',
      name: 'SocialCRM',
      operatingSystem: 'Web',
      applicationCategory: 'BusinessApplication',
      url: 'https://socialcrm.vercel.app',
      description:
        'מערכת ניהול לידים לעסקים קטנים — כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
      inLanguage: 'he',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'ILS',
        availability: 'https://schema.org/InStock',
      },
      featureList: [
        'ניהול לידים ממדיה חברתית',
        'חיבור אוטומטי לפייסבוק',
        'ייבוא לידים מאקסל',
        'מעקב אחר מכירות',
        'ניהול נציגים וצוותים',
      ],
      publisher: { '@id': 'https://socialcrm.vercel.app/#organization' },
    },
  ],
}

export default async function RootLayout({ children }) {
  return (
    <html lang='he' dir='rtl' data-scroll-behavior='smooth'>
      <head>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
        />
      </head>
      <body className={font.className}>
        <LayoutPageEvents />
        <ToastMsg />
        <main>{children}</main>
      </body>
    </html>
  )
}
