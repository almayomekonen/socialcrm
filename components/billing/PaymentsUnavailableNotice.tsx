import Icon from '@/lib/Icon'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'


/**
 * Shown wherever a card action would otherwise be offered while the provider
 * cannot complete one (see isCardBillingAvailable).
 *
 * Payment Links are gone, so there is no second way to pay and nothing honest
 * to offer instead. The one thing this must not do is show a button that opens
 * a setup which cannot finish — a dead end at the moment the customer is
 * trying to pay is worse than a plain "not right now".
 *
 * It never says a trial started or a payment succeeded, and it does not ask the
 * customer to do anything they cannot do.
 *
 * `hasAccess` exists because "your access is unaffected" is a lie to an account
 * that has none — a never-started trial has no CRM access at all, and telling
 * that customer nothing has changed would be the opposite of reassuring.
 */
export default function PaymentsUnavailableNotice({ action, hasAccess, locale = 'he' }: { action: 'start' | 'update'; hasAccess: boolean; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div role='status' dir={locale === 'he' ? 'rtl' : undefined} className='max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3'>
      <Icon name='circle-exclamation' className='bg-amber-700 size-5 mt-0.5 shrink-0' />
      <div className='space-y-1 text-sm'>
        <p className='font-semibold text-amber-900'>
          {action === 'start' ? t('settings.payment.unavailable.start') : t('settings.payment.unavailable.update')}
        </p>
        <p className='text-amber-800'>
          {hasAccess
            ? t('settings.payment.unavailable.withAccess')
            : t('settings.payment.unavailable.noAccess')}
        </p>
        <p className='text-amber-800'>{t('settings.payment.unavailable.later')}</p>
      </div>
    </div>
  )
}
