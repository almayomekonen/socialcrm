import type { Metadata } from 'next'

export { default } from '@/app/(marketing)/crm/page'

export const metadata: Metadata = {
  title: 'SocialCRM — מערכת ניהול לידים לעסקים קטנים',
  description:
    'מערכת CRM בעברית לניהול לידים מפייסבוק, אינסטגרם ווואטסאפ. ייבוא מאקסל, מעקב מכירות, ניהול נציגים. התחל בחינם.',
  alternates: { canonical: 'https://getsocialcrm.com/' },
  openGraph: {
    title: 'SocialCRM — מערכת ניהול לידים',
    description: 'כל הלידים מפייסבוק, אינסטגרם ווואטסאפ. במקום אחד. בלי לפספס אף ליד.',
    url: 'https://getsocialcrm.com/',
  },
}
