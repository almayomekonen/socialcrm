import { PRICING } from '@/lib/pricing'
import { BUSINESS_PHONE_HREF } from '@/lib/businessContact'

const SITE_URL = 'https://getsocialcrm.com'
const SITE_NAME = 'SocialCRM'

/**
 * Called with no options on the Hebrew site, which is the live output. `/en`
 * passes its English text. The software's own `inLanguage` stays Hebrew there:
 * it describes the product, whose interface is Hebrew.
 */
export function organizationSchema(opts: { description?: string; inLanguage?: string } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/media/logo.svg`,
      width: 200,
      height: 60,
    },
    description: opts.description ?? 'מערכת ניהול לידים ומכירות לעסקים קטנים בישראל',
    inLanguage: opts.inLanguage ?? 'he',
    areaServed: 'IL',
    // Clean profile URL only. The Facebook link in the footer is a share link
    // (facebook.com/share/...), which is not a stable profile URL; add the
    // Page's real URL here once it is known.
    sameAs: ['https://www.instagram.com/socialcrm.ai'],
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: BUSINESS_PHONE_HREF.replace('tel:', ''),
      contactType: 'customer support',
      areaServed: 'IL',
      availableLanguage: ['he', 'en'],
    },
  }
}

export function softwareApplicationSchema(opts: { description?: string; featureList?: string[] } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    operatingSystem: 'Web',
    applicationCategory: 'BusinessApplication',
    url: SITE_URL,
    description: opts.description ?? 'מערכת ניהול לידים לעסקים קטנים — כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
    inLanguage: 'he',
    // The one paid plan, from lib/pricing so it cannot drift. Not '0': there is
    // no free plan, and the 7-day trial needs a saved card (lib/trial).
    offers: {
      '@type': 'Offer',
      price: String(PRICING.monthly),
      priceCurrency: 'ILS',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: PRICING.monthly,
        priceCurrency: 'ILS',
        billingDuration: 'P1M',
      },
      availability: 'https://schema.org/InStock',
    },
    featureList: opts.featureList ?? [
      'ניהול לידים ממדיה חברתית',
      'חיבור אוטומטי לפייסבוק',
      'ייבוא לידים מאקסל',
      'מעקב אחר מכירות',
      'ניהול נציגים וצוותים',
    ],
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

export function websiteSchema(opts: { description?: string; inLanguage?: string } = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: opts.description ?? 'מערכת ניהול לידים לעסקים קטנים',
    inLanguage: opts.inLanguage ?? 'he',
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

export function webPageSchema(opts: { path: string; title: string; description: string; inLanguage?: string }) {
  const url = `${SITE_URL}${opts.path}`
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    url,
    name: opts.title,
    description: opts.description,
    inLanguage: opts.inLanguage ?? 'he',
    isPartOf: { '@id': `${SITE_URL}/#website` },
  }
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  }
}
