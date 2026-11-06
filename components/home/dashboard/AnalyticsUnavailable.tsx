import Link from 'next/link'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from './card'

// Shown when the analytics query fails. The brief above still works; the user
// learns what is missing and can retry without losing their place.
export default function AnalyticsUnavailable({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <Card role='status'>
      <CardHeader>
        <CardTitle className='text-[15px]'>{t('today.analytics.unavailableTitle')}</CardTitle>
        <CardDescription>{t('today.analytics.unavailableBody')}</CardDescription>
        <CardAction>
          <Link
            href='/dashboard'
            className='inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-semibold whitespace-nowrap text-ink hover:border-primary hover:text-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          >
            {t('today.analytics.reload')}
          </Link>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
