'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'

export type QuotaPaywallState = {
  current: number
  limit: number
  attempted: number
}

type Props = {
  state: QuotaPaywallState | null
  onClose: () => void
}

export default function QuotaPaywallModal({ state, onClose }: Props) {
  if (!state) return null

  const isBulk = state.attempted > 1
  const canInsert = Math.max(0, state.limit - state.current)

  return (
    <ModalPop open={!!state} pos='middle' onClose={onClose}>
      <div className='flex flex-col gap-5 min-w-[340px] max-w-[420px] pt-2'>
        <div>
          <p className='text-lg font-semibold whitespace-pre-line leading-snug'>
            {isBulk
              ? `הקובץ מכיל ${state.attempted} לידים, נותרו רק ${canInsert} במכסה החינמית.`
              : `כבר ניהלת ${state.limit} לידים כאן.`}
          </p>
          <p className='text-sm text-gray-600 mt-2'>
            {isBulk ? 'שדרג לייבא את כולם ולהמשיך ללא הגבלה.' : 'אל תעצור עכשיו המשך ללא הגבלה.'}
          </p>
        </div>

        <div className='bg-gray-50 border border-gray-200 rounded-lg px-4 py-3'>
          <p className='text-base font-semibold'>Pro · ₪{PRICING.monthly} לחודש</p>
          <p className='text-xs text-gray-600 mt-0.5'>
            או ₪{PRICING.annual} לשנה (₪{ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד) — חיסכון ₪{ANNUAL_SAVINGS} בשנה
          </p>
          <p className='text-xs text-gray-600 mt-0.5'>לידים ללא הגבלה</p>
        </div>

        <div className='flex justify-end gap-2'>
          <Btn variant='outline' lbl='מאוחר יותר' onClick={onClose} />
          <Btn
            variant='solid'
            lbl='שדרג עכשיו'
            onClick={() => {
              window.open('/api/payments/upgrade?source=quota_paywall', '_blank', 'noopener,noreferrer')
              onClose()
            }}
          />
        </div>
      </div>
    </ModalPop>
  )
}
