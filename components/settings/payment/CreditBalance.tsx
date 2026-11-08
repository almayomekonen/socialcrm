import type { ReactNode } from 'react'
import type { CreditBalanceView } from '@/lib/credits/balanceView'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'
import { formatRenewalDate } from './subscriptionDates'
import CreditPackButton from './CreditPackButton'

/**
 * Agent requests and purchased credits in the billing centre: the same section
 * and card as SubscriptionUsage. Cost stays internal. Where requests are not
 * limited it only reports usage and names no limit, so the plan's promise stands. Every purchase goes through an explicit confirmation.
 */

const whole = (n: number) => n.toLocaleString('he-IL')
const ils = (n: number) => `₪${n.toLocaleString('he-IL')}`

const STATUS_KEY: Record<string, MessageKey> = {
  succeeded: 'settings.payment.credits.historyStatus.succeeded',
  failed_final: 'settings.payment.credits.historyStatus.failed',
  failed_retryable: 'settings.payment.credits.historyStatus.failed',
  unknown: 'settings.payment.credits.historyStatus.unknown',
  pending: 'settings.payment.credits.historyStatus.pending',
  in_flight: 'settings.payment.credits.historyStatus.pending',
  cancelled: 'settings.payment.credits.historyStatus.cancelled',
}

export default function CreditBalance({ view, locale = 'he', linkMismatch = false, cardSetup }: { view: CreditBalanceView; locale?: UiLocale; linkMismatch?: boolean; cardSetup?: ReactNode }) {
  const t = translatorFor(locale)
  const label = t('settings.payment.credits.balance')
  const percent = view.freeLimit > 0 ? Math.min(100, Math.round((view.freeUsed / view.freeLimit) * 100)) : 0
  const warning = !view.enforced ? null : view.state === 'exhausted' ? t('settings.payment.credits.exhausted') : view.state === 'low' ? t('settings.payment.credits.low') : null

  return (
    <section className='mt-10' id='credits'>
      <h2 className='text-xl font-bold text-dark'>{t('settings.payment.credits.title')}</h2>
      <div className='mt-4 flex max-w-3xl flex-col gap-2.5 rounded-lg border border-gray-200 bg-white p-6'>
        <div className='flex items-baseline justify-between gap-3'>
          <span className='text-sm text-gray-900'>{label}</span>
          {view.enforced && <span className='text-sm text-gray-500'>{t('settings.payment.credits.freeUsed', { used: whole(Math.min(view.freeUsed, view.freeLimit)), limit: whole(view.freeLimit) })}</span>}
        </div>

        {view.enforced && view.freeLimit > 0 && (
          <div role='progressbar' aria-label={label} aria-valuenow={Math.min(view.freeUsed, view.freeLimit)} aria-valuemin={0} aria-valuemax={view.freeLimit} className='h-1.5 overflow-hidden rounded-full bg-gray-100'>
            <div className='h-full rounded-full bg-solid' style={{ width: `${percent}%` }} />
          </div>
        )}

        <p className='text-xs text-gray-500'>{view.enforced ? t('settings.payment.credits.includedNote', { limit: whole(view.freeLimit) }) : t('settings.payment.credits.aiIncludedNote')}</p>
        {!view.enforced && <p className='text-xs text-gray-500'>{t('settings.payment.credits.usedThisMonth', { value: whole(view.freeUsed) })}</p>}
        {view.purchasedAvailable > 0 && <p className='text-xs text-gray-500'>{t('settings.payment.credits.purchasedLeft', { value: whole(Math.floor(view.purchasedAvailable)) })}</p>}
        {view.exemptThisPeriod > 0 && <p className='text-xs text-gray-500'>{t('settings.payment.credits.founderExempt', { value: whole(view.exemptThisPeriod) })}</p>}
        {view.metering && !view.enforced && <p className='text-xs text-gray-500'>{t('settings.payment.credits.measuring')}</p>}
        {warning && (
          <p role='status' className='text-xs text-red-700'>
            {warning}
          </p>
        )}
        {linkMismatch && (
          <p role='status' className='text-xs text-red-700'>
            {t('settings.payment.credits.linkMismatch')}
          </p>
        )}

        {view.packs.length > 0 &&
          !linkMismatch &&
          (view.hasCard && !view.cardDeclined ? (
            <div className='mt-1 flex flex-wrap gap-2'>
              {view.packs.map((p) => (
                <CreditPackButton key={p.kind} kind={p.kind} credits={p.credits} price={ils(p.priceIls)} />
              ))}
            </div>
          ) : (
            (cardSetup ?? <p className='text-xs text-gray-500'>{t('settings.payment.credits.noCard')}</p>)
          ))}
      </div>

      {view.purchases.length > 0 && (
        <div className='mt-4 max-w-3xl rounded-lg border border-gray-200 bg-white p-6'>
          <h3 className='text-sm font-semibold text-gray-900'>{t('settings.payment.credits.historyTitle')}</h3>
          <ul className='mt-3 flex flex-col gap-2'>
            {view.purchases.map((p) => (
              <li key={p.id} className='flex items-baseline justify-between gap-3 text-sm text-gray-900'>
                <span>
                  {formatRenewalDate(p.createdAt, { withYear: true }, locale)} · {t('settings.payment.credits.packLabel', { credits: whole(p.credits ?? 0) })}
                </span>
                <span className='text-gray-500'>
                  {ils(p.amount)} · {t(STATUS_KEY[p.status] ?? 'settings.payment.credits.historyStatus.pending')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
