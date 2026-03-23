import { Metadata } from 'next'

const APP_NAME = 'SocialCRM'
const APP_TITLE_TEMPLATE = '%s | SocialCRM'
const APP_DESCRIPTION = 'מערכת ניהול לידים לעסקים קטנים — כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.'
const APP_URL = 'https://socialcrm.vercel.app'

export const metaData: Metadata = {
  metadataBase: new URL(APP_URL),

  title: APP_NAME,
  description: APP_DESCRIPTION,

  icons: {
    icon: '/media/fav.svg',
    shortcut: '/media/fav.svg',
    apple: '/media/fav.svg',
  },
  applicationName: APP_NAME,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: APP_NAME,
    startupImage: ['/media/og.png'],
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    url: APP_URL,
    type: 'website',
    siteName: APP_NAME,
    title: {
      default: APP_NAME,
      template: APP_TITLE_TEMPLATE,
    },
    images: [
      {
        url: '/media/og.png',
        alt: 'SocialCRM — מערכת ניהול לידים לעסקים קטנים',
        width: 1200,
        height: 630,
      },
    ],
    description: APP_DESCRIPTION,
    locale: 'he_IL',
  },
  verification: {
    google: 'x7wFbbGsjeTClNQbHJI5b7mg2btRMEF-9KdUSwkNN7I',
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: APP_NAME,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
    images: [
      {
        url: '/media/og.png',
        alt: 'SocialCRM — מערכת ניהול לידים לעסקים קטנים',
        width: 1200,
        height: 630,
      },
    ],
  },
}

export const baseUrl = process.env.NODE_ENV === 'production' ? 'https://socialcrm.vercel.app' : 'http://localhost:3000'

export const fileSizes = [
  {
    name: 'עד 1MB',
    id: 1 * 1024 * 1024,
  },
  {
    name: 'עד 10MB',
    id: 10 * 1024 * 1024,
  },
  {
    name: 'עד 100MB',
    id: 100 * 1024 * 1024,
  },
  {
    name: 'עד 1GB',
    id: 1024 * 1024 * 1024,
  },
]
