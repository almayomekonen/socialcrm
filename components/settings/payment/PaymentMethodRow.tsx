import Icon from '@/lib/Icon'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * The subscription card's footer band: which payment method gets charged.
 *
 * It names the holder of the card, not the card. Brand, last four digits and
 * expiry are stored nowhere in this system — `subscriptions` has no card
 * columns and the Grow webhook persists only a transaction id
 * (app/api/payments/grow/route.ts) — so any digits rendered here would be
 * invented. Showing a paying customer a card that is not theirs is the one
 * mistake the care charter treats as unrecoverable, so the row answers the
 * question at the resolution the data actually supports.
 *
 * No CTA, deliberately: there is no change-card flow to send anyone to. The
 * manage-plan modal only cancels and resumes, so an "עדכון אמצעי תשלום" link
 * would be a dead end. When card capture lands, the details and the action
 * belong here together.
 *
 * `state` exists because this row held the last sentence on the page still
 * promising a charge that is not coming — in TWO different situations, for the
 * same reason. It sits directly beneath the plan's status badge and said
 * "החיוב הבא" would be taken from the card both to a customer whose
 * subscription had already ended and to one who had cancelled.
 *
 * Same rule as ManagePlanModal: a future charge is claimed ONLY while the
 * subscription is genuinely renewing. The fact about the stored card is
 * unchanged and still true in all three states; only its tense is. A renewing
 * customer keeps the original sentence verbatim.
 *
 * THE CANCELLING LINE MAKES NO PREDICTION EITHER WAY. It used to read "המנוי
 * לא יתחדש ולא ייגבה חיוב נוסף" — the most explicit promise on the page, and
 * the one this system is least able to keep: cancelling sets a flag on our own
 * subscriptions row and contacts no payment provider, so the standing order is
 * untouched and a further charge is entirely possible. Predicting "no further
 * charge" was therefore a guess presented as a guarantee, and predicting the
 * opposite would be a different guess. It now states the one thing that is
 * true — the request is recorded — and stops there. When provider cancellation
 * is genuinely confirmed, a definite sentence becomes available again.
 */
export type PaymentMethodState = 'renewing' | 'cancelling' | 'expired' | 'granted'

const CHARGE_COPY: Record<PaymentMethodState, MessageKey> = {
  renewing: 'settings.payment.row.renewing',
  cancelling: 'settings.payment.row.cancelling',
  expired: 'settings.payment.row.expired',
  /* An explicit grant has no subscription and no scheduled charge. Every other
     line here names a charge — past, next or conditional — and all three would
     be inventions on this account. */
  granted: 'settings.payment.row.granted',
}

export default function PaymentMethodRow({ state = 'renewing', locale = 'he' }: { state?: PaymentMethodState; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='flex items-center gap-4 border-t border-gray-100 px-6 py-4'>
      <Icon name='credit-card' type='reg' className='size-5 shrink-0 bg-gray-400' />
      <div className='min-w-0'>
        <p className='text-sm text-gray-800'>{t('settings.payment.row.holder')}</p>
        <p className='mt-0.5 text-xs text-gray-500'>{t(CHARGE_COPY[state])}</p>
      </div>
    </div>
  )
}
