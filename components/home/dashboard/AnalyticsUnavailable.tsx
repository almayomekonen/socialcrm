import Link from 'next/link'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from './card'
import { btn } from './ui'

// Shown when the analytics query fails. The brief above still works; the user
// learns what is missing and can retry without losing their place.
export default function AnalyticsUnavailable({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <Card role='status'>
      <CardHeader>
        <CardTitle>{t('today.analytics.unavailableTitle')}</CardTitle>
        <CardDescription>{t('today.analytics.unavailableBody')}</CardDescription>
        <CardAction>
          <Link href='/dashboard' className={`${btn.base} ${btn.outline} ${btn.sm}`}>
            {t('today.analytics.reload')}
          </Link>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
