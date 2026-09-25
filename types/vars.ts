import { Metadata } from 'next'

const APP_NAME = 'SocialCRM'
const APP_OG_TITLE = 'כל הלידים שלך. מסודרים. סגורים.'
const APP_OG_DESCRIPTION = 'הפסק לפספס לידים. קבל שליטה מלאה על כל הפניות שלך ותתחיל לסגור יותר עסקאות — כבר מהיום.'
const APP_TWITTER_DESCRIPTION = 'הפסק לפספס לידים ותתחיל לסגור יותר עסקאות.'
const APP_DESCRIPTION = 'מערכת ניהול לידים לעסקים קטנים כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.'
const APP_URL = 'https://getsocialcrm.com'

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
    google: '5PPPOQHX-e0jvKT51ezLsvkfJGA2IHqF2qc0nInkAK0',
    other: { 'facebook-domain-verification': '3tdbdd0j1lloin81ft8kr3pvyydccs' },
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

/** The only origin production is ever allowed to mint links to. */
const PRODUCTION_ORIGIN = 'https://getsocialcrm.com'

/**
 * `host` arrives bare ("x.vercel.app") or with a scheme, from CONFIGURATION —
 * APP_HOST, which we set, or VERCEL_URL, which the platform sets. Never from a
 * Host or X-Forwarded-* header: those are supplied by the caller, and an origin
 * taken from them would let anyone aim our sign-in emails wherever they liked.
 */
function originFromHost(host: string | undefined): string | null {
  const bare = host?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return bare ? `https://${bare}` : null
}

export function resolveBaseUrl(): string {
  /**
   * A NON-PRODUCTION deployment must never mint a link to production.
   *
   * Both branches below resolve to getsocialcrm.com on a preview:
   * APP_URL / NEXT_PUBLIC_APP_URL are shared Production+Preview variables
   * holding the production origin, and NODE_ENV is 'production' in every Vercel
   * build, previews included. That is what broke email sign-in on staging: the
   * magic-link token is written to THIS environment's database, so a link
   * pointing at production is verified against a database that has never seen
   * the token, and the sign-in fails every time.
   *
   * APP_HOST is the same configured origin Grow callbacks already trust. A
   * preview that merely inherited the production APP_HOST is not a staging
   * origin, so it falls through to the deployment's own URL, which cannot be
   * production by construction.
   */
  const deployment = process.env.VERCEL_ENV
  if (deployment && deployment !== 'production') {
    // APP_HOST is marked sensitive in Vercel, so it exists at RUNTIME but not
    // during the build. Server actions (sendToken) read it; statically
    // prerendered pages cannot, which is why the next two fallbacks matter.
    const configured = originFromHost(process.env.APP_HOST)
    if (configured && configured !== PRODUCTION_ORIGIN) return configured

    // A branch-scoped NEXT_PUBLIC_APP_URL is readable at build time and names
    // the stable alias. Accepted only when it is NOT the production origin —
    // the shared Production+Preview value is, and that is the original bug.
    const declared = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.trim().replace(/\/$/, '')
    if (declared && declared !== PRODUCTION_ORIGIN) return declared

    // Last resort: this deployment's own URL. Never production, by construction.
    const own = originFromHost(process.env.VERCEL_URL)
    if (own) return own
  }

  const explicit = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_ORIGIN
  if (process.env.NODE_ENV === 'production') return PRODUCTION_ORIGIN

  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3000'
}

export const baseUrl = resolveBaseUrl()

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
