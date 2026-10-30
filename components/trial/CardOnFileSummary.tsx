import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'
import type { CardTrialView } from '@/lib/payments/cardTrial/cardTrialView'
import CardBillingControls from './CardBillingControls'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * The card on file and what will happen next, on the billing page. Every fact
 * comes from the server read model (cardTrialView): the card digits we stored,
 * the charge date derived from the persisted trial end, and the payment phase.
 */

const PAYMENT_NOTE: Record<CardTrialView['payment'], MessageKey | null> = {
  none: null,
  scheduled: 'settings.payment.card.payment.scheduled',
  in_progress: 'settings.payment.card.payment.in_progress',
  unknown: 'settings.payment.card.payment.unknown',
  declined: 'settings.payment.card.payment.declined',
  paid: null,
}

/**
 * `granted` — agencies.plan 'pro' from an explicit non-'grow:' planReason.
 *
 * Every schedule-shaped sentence here is read off the subscription model, and
 * on a grant there is no subscription: no monthly charge, no next charge date,
 * nothing to cancel before. Agency 103 held a comp and a stored card and was
 * still told "חיוב חודשי פעיל" and "החיוב הבא: ₪89 ב־22/09/2026" — a charge
 * that no scheduler will ever produce (proven against both scheduling queries,
 * which select it zero times).
 *
 * The card itself is real and stays: it is shown, and it can be replaced.
 */
export default function CardOnFileSummary({ view, granted = false, locale = 'he' }: { view: CardTrialView; granted?: boolean; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const chargeDate = formatBillingDate(view.firstChargeAt)
  const noteKey = PAYMENT_NOTE[view.payment]
  const note = noteKey ? t(noteKey) : null

  return (
    <div className='mb-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex flex-col gap-3' dir={locale === 'he' ? 'rtl' : undefined}>
      <div className='flex items-center justify-between gap-4 flex-wrap'>
        <p className='text-lg font-semibold'>{t('settings.payment.card.title')}</p>
        <span className='rounded-full px-2.5 py-0.5 text-xs font-medium border bg-gray-50 border-gray-200 text-gray-700'>
          {granted ? t('settings.payment.card.saved') : view.cancelAtPeriodEnd ? t('settings.payment.card.endsAtPeriod') : t('settings.payment.card.monthlyActive')}
        </span>
      </div>

      <p className='text-sm text-gray-700'>
        {view.card ? `${t('settings.payment.card.saved')}${view.card.brand ? ` · ${view.card.brand}` : ''}${view.card.suffix ? ` •••• ${view.card.suffix}` : ''}` : t('settings.payment.card.none')}
      </p>

      {granted ? (
        <p className='text-sm text-gray-700'>{t('settings.payment.card.grantNote')}</p>
      ) : (
        chargeDate && (
          <p className='text-sm text-gray-700'>
            {view.cancelAtPeriodEnd
              ? t('settings.payment.card.noMore', { date: chargeDate })
              : t('settings.payment.card.next', { amount: `₪${CARD_TRIAL_AMOUNT}`, date: chargeDate })}
          </p>
        )
      )}

      {note && <p className='text-sm text-gray-600'>{note}</p>}

      <CardBillingControls
        granted={granted}
        cancelAtPeriodEnd={view.cancelAtPeriodEnd}
        chargeInProgress={view.payment === 'in_progress' || view.payment === 'unknown'}
      />
    </div>
  )
}
