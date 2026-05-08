const SITE_URL = 'https://getsocialcrm.com'
const SITE_NAME = 'SocialCRM'

export function organizationSchema() {
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
    description: 'מערכת ניהול לידים ומכירות לעסקים קטנים בישראל',
    inLanguage: 'he',
    areaServed: 'IL',
  }
}

export function softwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: SITE_NAME,
    operatingSystem: 'Web',
    applicationCategory: 'BusinessApplication',
    url: SITE_URL,
    description: 'מערכת ניהול לידים לעסקים קטנים — כל הלידים מפייסבוק, אינסטגרם ווואטסאפ במקום אחד. בלי לפספס אף ליד.',
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
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: 'מערכת ניהול לידים לעסקים קטנים',
    inLanguage: 'he',
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

export function webPageSchema(opts: { path: string; title: string; description: string }) {
  const url = `${SITE_URL}${opts.path}`
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': url,
    url,
    name: opts.title,
    description: opts.description,
    inLanguage: 'he',
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
