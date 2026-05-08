import type { Metadata } from 'next'

const SITE_URL = 'https://getsocialcrm.com'

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

  const metadata: Metadata = {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: ogTitle ?? title,
      description: ogDescription ?? description,
      url: canonicalUrl,
    },
    twitter: {
      title: ogTitle ?? title,
      description: ogDescription ?? description,
    },
  }

  if (noindex) {
    metadata.robots = { index: false, follow: false }
  }

  return metadata
}
