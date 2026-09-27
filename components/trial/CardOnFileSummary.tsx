import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { CARD_TRIAL_AMOUNT } from '@/lib/payments/cardTrial/terms'
import type { CardTrialView } from '@/lib/payments/cardTrial/cardTrialView'
import CardBillingControls from './CardBillingControls'

/**
 * The card on file and what will happen next, on the billing page. Every fact
 * comes from the server read model (cardTrialView): the card digits we stored,
 * the charge date derived from the persisted trial end, and the payment phase.
 */

const PAYMENT_NOTE: Record<CardTrialView['payment'], string | null> = {
  none: null,
  scheduled: 'החיוב הקרוב ממתין לביצוע.',
  in_progress: 'החיוב נשלח לעיבוד — נעדכן ברגע שתתקבל תשובה.',
  unknown: 'אנחנו מוודאים מול חברת הסליקה אם החיוב האחרון בוצע. לא יבוצע חיוב נוסף עד שנדע.',
  declined: 'החיוב האחרון לא אושר. אפשר להחליף כרטיס וננסה שוב.',
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
export default function CardOnFileSummary({ view, granted = false }: { view: CardTrialView; granted?: boolean }) {
  const chargeDate = formatBillingDate(view.firstChargeAt)
  const note = PAYMENT_NOTE[view.payment]

  return (
    <div className='mb-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex flex-col gap-3' dir='rtl'>
      <div className='flex items-center justify-between gap-4 flex-wrap'>
        <p className='text-lg font-semibold'>אמצעי תשלום</p>
        <span className='rounded-full px-2.5 py-0.5 text-xs font-medium border bg-gray-50 border-gray-200 text-gray-700'>
          {granted ? 'כרטיס שמור' : view.cancelAtPeriodEnd ? 'המנוי יסתיים בתום התקופה' : 'חיוב חודשי פעיל'}
        </span>
      </div>

      <p className='text-sm text-gray-700'>
        {view.card ? `כרטיס שמור${view.card.brand ? ` · ${view.card.brand}` : ''}${view.card.suffix ? ` •••• ${view.card.suffix}` : ''}` : 'אין כרטיס שמור'}
      </p>

      {granted ? (
        <p className='text-sm text-gray-700'>הכרטיס שמור לשימוש עתידי. לא נקבע חיוב.</p>
      ) : (
        chargeDate && (
          <p className='text-sm text-gray-700'>
            {view.cancelAtPeriodEnd
              ? `לא יבוצע חיוב נוסף. הגישה נמשכת עד ${chargeDate}.`
              : `החיוב הבא: ₪${CARD_TRIAL_AMOUNT} ב־${chargeDate}, ומדי חודש לאחר מכן.`}
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
