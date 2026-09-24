import { formatDate } from '@/lib/dates'
import UpgradeBtn from '@/components/settings/payment/UpgradeBtn'
import { PRICING } from '@/lib/pricing'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'

type Props = {
  startedAt: Date
  endsAt: Date
  daysRemaining: number
  /**
   * Card-token trial: the trial converts automatically instead of suspending
   * access, so the closing copy and the action differ. The card itself and its
   * controls live in CardOnFileSummary, directly above this card.
   */
  cardBilled?: boolean
  cancelAtPeriodEnd?: boolean
}


export default function TrialStatusCard({ startedAt, endsAt, daysRemaining, cardBilled = false, cancelAtPeriodEnd = false }: Props) {
  const endingSoon = daysRemaining <= 2
  const totalMs = Math.max(endsAt.getTime() - startedAt.getTime(), 1)
  const elapsedMs = Math.min(Math.max(Date.now() - startedAt.getTime(), 0), totalMs)
  const pct = Math.round((elapsedMs / totalMs) * 100)

  const daysLabel = daysRemaining === 1 ? 'יום אחרון לתקופת הניסיון' : `${daysRemaining} ימים נותרו לתקופת הניסיון`

  return (
    <div className='mb-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-4'>
        <p className='text-lg font-semibold'>תקופת ניסיון</p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${
            endingSoon ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {endingSoon ? 'הניסיון מסתיים בקרוב' : 'ניסיון פעיל'}
        </span>
      </div>

      <div>
        <p className='text-2xl font-bold leading-tight'>{daysLabel}</p>
        <p className='text-sm text-gray-500 mt-1'>
          התחלה: {formatDate(startedAt)} · סיום: {formatDate(endsAt)}
        </p>
      </div>

      <div
        className='h-2 rounded-full bg-gray-100 overflow-hidden'
        role='progressbar'
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label='התקדמות תקופת הניסיון'
      >
        <div className={`h-full rounded-full ${endingSoon ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>

      {cardBilled ? (
        <p className='text-sm text-gray-600'>
          {cancelAtPeriodEnd
            ? `ביטלת את המשך המנוי. הגישה נמשכת עד ${formatBillingDate(endsAt)} ולא יבוצע חיוב.`
            : `בתום תקופת הניסיון, ב־${formatBillingDate(endsAt)}, יחויב הכרטיס השמור ב־₪${PRICING.monthly} לחודש והעבודה תימשך ללא הפסקה.`}
        </p>
      ) : (
        <div className='flex items-center justify-between gap-4 flex-wrap'>
          <p className='text-sm text-gray-600'>
            בסיום תקופת הניסיון הגישה תושהה עד לשדרוג, כל הלידים והנתונים שלך נשמרים.
            {/* No annual upsell: this release sells a monthly subscription and
                nothing else, so an annual saving here points at a plan the
                customer cannot actually buy. */}
            <span className='block text-xs text-gray-500 mt-0.5'>המנוי הוא ₪{PRICING.monthly} לחודש, עד לביטול.</span>
          </p>
          <UpgradeBtn source='billing_trial_card' />
        </div>
      )}
    </div>
  )
}
