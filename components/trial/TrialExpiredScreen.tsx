'use client'

import { Check } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'

const PRO_BENEFITS = ['AI ללא הגבלה במצב מהיר ובמצב חכם', 'היסטוריית AI מלאה לכל ליד', 'ניסוח הודעות, המלצות וצעדים הבאים']

type Props = {
  leadCount?: number
  leadNames?: string[]
}

export default function TrialExpiredScreen({ leadCount = 0, leadNames = [] }: Props) {
  const hasLeads = leadCount > 0 && leadNames.length > 0
  const remaining = leadCount - leadNames.length

  return (
    <div className='fixed inset-0 z-99999 flex items-center justify-center p-4 bg-gray-950/25 backdrop-blur-sm anim-fade-in'>
      <div
        dir='rtl'
        className='flex flex-col gap-6 w-full max-w-[440px] bg-gray-900 rounded-2xl p-8 shadow-2xl shadow-gray-900/40'
      >
        <div>
          <span className='inline-block text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>Pro</span>
          <h1 className='text-2xl font-bold leading-snug text-white mt-4'>
            {hasLeads ? 'הלידים שלך מחכים' : 'המערכת שלך מחכה לך'}
          </h1>
          <p className='text-sm text-white/70 mt-2 leading-relaxed'>
            הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך לעבוד יש לשדרג.
          </p>
        </div>

        {hasLeads && (
          <div className='flex flex-col gap-1.5'>
            {leadNames.map((name, i) => (
              <div
                key={`${name}-${i}`}
                className='flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 anim-fade-scale-in'
                style={{ ['--anim-duration' as string]: '0.4s', animationDelay: `${i * 110}ms`, animationFillMode: 'backwards' }}
              >
                <span className='grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white/80'>
                  {name.trim().charAt(0)}
                </span>
                <span className='truncate text-sm text-white/90'>{name}</span>
                <span className='ms-auto size-1.5 shrink-0 rounded-full bg-emerald-400/80' aria-hidden='true' />
              </div>
            ))}
            {remaining > 0 && <p className='text-xs text-white/50 px-1'>ועוד {remaining} לידים ממתינים לחזרה שלך</p>}
          </div>
        )}

        <div>
          <p className='text-4xl font-extrabold text-white'>
            ₪{PRICING.monthly}
            <span className='text-base font-normal text-white/50 mr-1'>/חודש</span>
          </p>
          <p className='text-xs text-white/50 mt-1'>
            או ₪{PRICING.annual} לשנה (₪{ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד) — חיסכון ₪{ANNUAL_SAVINGS} בשנה
          </p>
        </div>

        <ul className='list-none space-y-2.5'>
          {PRO_BENEFITS.map((benefit) => (
            <li key={benefit} className='flex items-start gap-3'>
              <Check className='h-4 w-4 shrink-0 mt-0.5 text-white' aria-hidden='true' />
              <span className='text-sm text-white/90'>{benefit}</span>
            </li>
          ))}
        </ul>

        <div className='flex flex-col gap-2'>
          <Btn
            variant='solid'
            size='large'
            lbl='שדרג עכשיו'
            className='w-full bg-white text-gray-900 font-bold hover:bg-gray-100'
            onClick={() => {
              window.location.href = '/api/payments/upgrade?source=trial_expired_screen'
            }}
          />
          <p className='text-[11px] text-white/40 text-center'>ללא התחייבות · ניתן לבטל בכל רגע · כל הנתונים שלך שמורים</p>
        </div>
      </div>
    </div>
  )
}
