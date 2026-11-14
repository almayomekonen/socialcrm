import type { Metadata } from 'next'

const SITE_URL = 'https://getsocialcrm.com'
const SITE_NAME = 'SocialCRM'
const LOCALE = 'he_IL'

// Absolute URL is required by WhatsApp / Facebook / Twitter crawlers — they
// fetch the og:image URL exactly as declared, with no base resolution.
const OG_IMAGE_URL = `${SITE_URL}/media/og.png`
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630
const OG_IMAGE_TYPE = 'image/png'

export interface PageMetadataOptions {
  path: string
  title: string
  description: string
  ogTitle?: string
  ogDescription?: string
  canonical?: string
  noindex?: boolean
  /** og:locale, for a page that is not in Hebrew. */
  locale?: string
  /** hreflang alternates. Only for a page that really exists in another language. */
  languages?: Record<string, string>
  /** This page's own 1200×630 PNG under /public (e.g. `/media/og/crm.png`). Defaults to the site image. */
  ogImage?: string
}

/** The one page that exists in both languages. `x-default` is the English page. */
export const HOME_LANGUAGES = {
  he: `${SITE_URL}/`,
  en: `${SITE_URL}/en`,
  'x-default': `${SITE_URL}/en`,
}

export function buildPageMetadata(opts: PageMetadataOptions): Metadata {
  const { path, title, description, ogTitle, ogDescription, canonical, noindex, locale = LOCALE, languages, ogImage } = opts
  const ogImageUrl = ogImage ? `${SITE_URL}${ogImage}` : OG_IMAGE_URL
  const canonicalUrl = canonical ?? `${SITE_URL}${path}`
  const finalOgTitle = ogTitle ?? title
  const finalOgDescription = ogDescription ?? description

  const metadata: Metadata = {
    title,
    description,
    alternates: languages ? { canonical: canonicalUrl, languages } : { canonical: canonicalUrl },
    openGraph: {
      title: finalOgTitle,
      description: finalOgDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      locale,
      type: 'website',
      images: [
        {
          url: ogImageUrl,
          secureUrl: ogImageUrl,
          alt: finalOgTitle,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          type: OG_IMAGE_TYPE,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: finalOgTitle,
      description: finalOgDescription,
      images: [
        {
          url: ogImageUrl,
          alt: finalOgTitle,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
        },
      ],
    },
  }

  if (noindex) {
    metadata.robots = { index: false, follow: false }
  }

  return metadata
}
