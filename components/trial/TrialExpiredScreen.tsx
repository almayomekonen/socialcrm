'use client'

import { Check } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'
import LeadEntryToasts from './LeadEntryToasts'
import CardTrialSetupForm from './CardTrialSetupForm'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'

const PRO_BENEFITS = ['AI ללא הגבלה במצב מהיר ובמצב חכם', 'היסטוריית AI מלאה לכל ליד', 'ניסוח הודעות, המלצות וצעדים הבאים']

export type CardReactivationReason = 'declined' | 'cancelled' | 'ended'

type Props = {
  leadCount?: number
  leadNames?: string[]
  /**
   * Card-token agency: recovery is updating the card and continuing, not a
   * Payment Link (which would open a second Grow standing order).
   */
  cardReactivation?: { reason: CardReactivationReason }
}

const REACTIVATION_BODY: Record<CardReactivationReason, string> = {
  declined: 'לא הצלחנו לחייב את הכרטיס ששמרת. הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך, יש לאשר אמצעי תשלום.',
  cancelled: 'ביטלת את המשך המנוי. הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם, ואפשר להמשיך בכל רגע.',
  ended: 'הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך, יש לאשר אמצעי תשלום.',
}

export default function TrialExpiredScreen({ leadCount = 0, leadNames = [], cardReactivation }: Props) {
  const hasLeads = leadCount > 0

  return (
    <div className='fixed inset-0 z-99999 flex items-center justify-center p-4 bg-gray-950/20 backdrop-blur-[2px] anim-fade-in'>
      {/* Live lead toasts over the blurred dashboard, behind the card. */}
      <LeadEntryToasts names={leadNames} />

      <div
        dir='rtl'
        className='relative z-10 flex flex-col gap-6 w-full max-w-[440px] bg-gray-900 rounded-2xl p-8 shadow-2xl shadow-gray-900/40'
      >
        <div>
          <span className='inline-block text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>Pro</span>
          <h1 className='text-2xl font-bold leading-snug text-white mt-4'>
            {hasLeads ? 'הלידים שלך מחכים' : 'המערכת שלך מחכה לך'}
          </h1>
          <p className='text-sm text-white/70 mt-2 leading-relaxed'>
            {cardReactivation ? REACTIVATION_BODY[cardReactivation.reason] : 'הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך לעבוד יש לשדרג.'}
          </p>
          {hasLeads && (
            <p className='text-sm text-white/80 mt-3'>
              <span className='font-bold text-white'>{leadCount}</span> לידים ממתינים לחזרה שלך
            </p>
          )}
        </div>

        <div>
          <p className='text-4xl font-extrabold text-white'>
            ₪{PRICING.monthly}
            <span className='text-base font-normal text-white/50 mr-1'>/חודש</span>
          </p>
          {/* Card-token billing is monthly only, so the annual offer is not
              available in the reactivation flow and must not be advertised there. */}
          {!cardReactivation && (
            <p className='text-xs text-white/50 mt-1'>
              או ₪{PRICING.annual} לשנה (₪{ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד) חיסכון ₪{ANNUAL_SAVINGS} בשנה
            </p>
          )}
        </div>

        <ul className='list-none space-y-2.5'>
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit} className='flex items-start gap-3'>
              <Check className='h-4 w-4 shrink-0 mt-0.5 text-white' aria-hidden='true' />
              <span className='text-sm text-white/90'>{benefit}</span>
            </li>
          ))}
        </ul>

        {cardReactivation ? (
          <div className='rounded-xl bg-white p-4'>
            <CardTrialSetupForm purpose='reactivate' submitLabel='עדכון אמצעי תשלום והמשך' />
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <Btn
              variant='solid'
              size='large'
              lbl='שדרג עכשיו'
              className='w-full bg-white text-gray-900 font-bold hover:bg-gray-100'
              onClick={() => {
                window.location.href = upgradeHref('trial_expired_screen')
              }}
            />
            <p className='text-[11px] text-white/40 text-center'>ללא התחייבות · ניתן לבטל בכל רגע · כל הנתונים שלך שמורים</p>
          </div>
        )}
      </div>
    </div>
  )
}
