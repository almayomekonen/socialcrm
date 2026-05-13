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
}

export function buildPageMetadata(opts: PageMetadataOptions): Metadata {
  const { path, title, description, ogTitle, ogDescription, canonical, noindex } = opts
  const canonicalUrl = canonical ?? `${SITE_URL}${path}`
  const finalOgTitle = ogTitle ?? title
  const finalOgDescription = ogDescription ?? description

  const metadata: Metadata = {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: finalOgTitle,
      description: finalOgDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      locale: LOCALE,
      type: 'website',
      images: [
        {
          url: OG_IMAGE_URL,
          secureUrl: OG_IMAGE_URL,
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
          url: OG_IMAGE_URL,
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
