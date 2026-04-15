import { Metadata } from 'next'

const APP_NAME = 'SocialCRM'
const APP_OG_TITLE = 'כל הלידים שלך. מסודרים. סגורים.'
const APP_OG_DESCRIPTION = 'הפסק לפספס לידים. קבל שליטה מלאה על כל הפניות שלך ותתחיל לסגור יותר עסקאות — כבר מהיום.'
const APP_TWITTER_DESCRIPTION = 'הפסק לפספס לידים ותתחיל לסגור יותר עסקאות.'
const APP_DESCRIPTION = 'מערכת ניהול לידים לעסקים קטנים כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.'
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
    title: APP_OG_TITLE,
    images: [
      {
        url: '/media/og.png',
        alt: APP_OG_TITLE,
        width: 1200,
        height: 630,
      },
    ],
    description: APP_OG_DESCRIPTION,
    locale: 'he_IL',
  },
  verification: {
    google: 'x7wFbbGsjeTClNQbHJI5b7mg2btRMEF-9KdUSwkNN7I',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_OG_TITLE,
    description: APP_TWITTER_DESCRIPTION,
    images: [
      {
        url: '/media/og.png',
        alt: APP_OG_TITLE,
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
