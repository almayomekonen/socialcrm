import { formatDate } from '@/lib/dates'
import UpgradeBtn from '@/components/settings/payment/UpgradeBtn'

type Props = {
  startedAt: Date
  endsAt: Date
  daysRemaining: number
}

/**
 * Trial lifecycle card for Settings → Billing. Server component; renders
 * only while the trial is ACTIVE — expired users never reach this page (the
 * layout gate shows TrialExpiredScreen instead) and pre-activation users are
 * behind the welcome modal. "Ending soon" (≤ 2 days) is a visual variant,
 * not a separate state.
 */
export default function TrialStatusCard({ startedAt, endsAt, daysRemaining }: Props) {
  const endingSoon = daysRemaining <= 2
  const totalMs = Math.max(endsAt.getTime() - startedAt.getTime(), 1)
  const elapsedMs = Math.min(Math.max(Date.now() - startedAt.getTime(), 0), totalMs)
  const pct = Math.round((elapsedMs / totalMs) * 100)

  const daysLabel = daysRemaining === 1 ? 'יום אחרון לתקופת הניסיון' : `${daysRemaining} ימים נותרו לתקופת הניסיון`

  return (
    <div className='my-6 max-w-3xl p-6 bg-white rounded-lg border border-gray-200 flex flex-col gap-4'>
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

      <div className='flex items-center justify-between gap-4 flex-wrap'>
        <p className='text-sm text-gray-600'>
          בסיום תקופת הניסיון הגישה תושהה עד לשדרוג, כל הלידים והנתונים שלך נשמרים.
        </p>
        <UpgradeBtn source='billing_trial_card' />
      </div>
    </div>
  )
}
