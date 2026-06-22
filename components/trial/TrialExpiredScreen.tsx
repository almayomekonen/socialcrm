'use client'

import { Check } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'

const PRO_BENEFITS = ['AI ללא הגבלה במצב מהיר ובמצב חכם', 'היסטוריית AI מלאה לכל ליד', 'ניסוח הודעות, המלצות וצעדים הבאים']

export default function TrialExpiredScreen() {
  return (
    <div className='fixed inset-0 z-99999 flex items-center justify-center p-4 bg-gray-950/30 backdrop-blur-md anim-fade-in'>
      <div
        dir='rtl'
        className='flex flex-col gap-6 w-full max-w-[440px] bg-gray-900 rounded-2xl p-8 shadow-2xl shadow-gray-900/40'
      >
        <div>
          <span className='inline-block text-xs font-bold px-3 py-1 bg-white text-gray-900 rounded-full'>Pro</span>
          <h1 className='text-2xl font-bold leading-snug text-white mt-4'>המערכת שלך מחכה לך</h1>
          <p className='text-sm text-white/70 mt-2 leading-relaxed'>
            הלידים והנתונים שלך נשמרו בדיוק כפי שהשארת אותם. כדי להמשיך לעבוד יש לשדרג.
          </p>
        </div>

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
