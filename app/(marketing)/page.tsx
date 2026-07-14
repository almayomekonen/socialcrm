import { buildPageMetadata } from '@/lib/seo/metadata'

export { default } from '@/app/(marketing)/crm/page'

export const metadata = buildPageMetadata({
  path: '/',
  title: 'SocialCRM — מערכת ניהול לידים לעסקים קטנים',
  description:
    'מערכת CRM בעברית לניהול לידים מפייסבוק ואינסטגרם ומוואטסאפ. ייבוא מאקסל, מעקב מכירות, ניהול נציגים. התחל בחינם.',
  ogTitle: 'SocialCRM — מערכת ניהול לידים',
  ogDescription: 'כל הלידים מפייסבוק ואינסטגרם ומוואטסאפ. במקום אחד. בלי לפספס אף ליד.',
})
