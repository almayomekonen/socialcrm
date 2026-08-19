'use client'

import { PRICING, ANNUAL_MONTHLY_EQUIVALENT, ANNUAL_SAVINGS } from '@/lib/pricing'
import BottomSheet from '@/components/mobile/BottomSheet'
import type { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'

type Props = {
  state: QuotaPaywallState | null
  onClose: () => void
}

/**
 * Phone presentation of the existing quota paywall.
 *
 * Semantics, copy, and the upgrade URL are the same as `QuotaPaywallModal`.
 * The desktop modal's `min-w-[340px]` plus `p-8` cannot be trusted at 360px,
 * so this sheet is the mobile surface — the quota backend is untouched.
 */
export default function QuotaPaywallMobile({ state, onClose }: Props) {
  const isBulk = !!state && state.attempted > 1
  const canInsert = state ? Math.max(0, state.limit - state.current) : 0

  return (
    <BottomSheet
      open={!!state}
      onClose={onClose}
      title='מכסת הלידים'
      titleId='quota-paywall-title'
      dismissOnScrim={false}
    >
      {state ? (
      <div className='flex flex-col gap-4'>
        <div>
          <p className='text-base font-semibold leading-snug text-ink'>
            {isBulk
              ? `הקובץ מכיל ${state.attempted} לידים, נותרו רק ${canInsert} במכסה החינמית.`
              : `כבר ניהלת ${state.limit} לידים כאן.`}
          </p>
          <p className='mt-2 text-sm text-gray-600'>
            {isBulk ? 'שדרג לייבא את כולם ולהמשיך ללא הגבלה.' : 'אל תעצור עכשיו המשך ללא הגבלה.'}
          </p>
        </div>

        <div className='rounded-lg border border-gray-200 bg-gray-50 px-4 py-3'>
          <p className='text-base font-semibold'>{`Pro · ₪${PRICING.monthly} לחודש`}</p>
          <p className='mt-0.5 text-xs text-gray-600'>
            {`או ₪${PRICING.annual} לשנה (₪${ANNUAL_MONTHLY_EQUIVALENT} לחודש בלבד) — חיסכון ₪${ANNUAL_SAVINGS} בשנה`}
          </p>
          <p className='mt-0.5 text-xs text-gray-600'>לידים ללא הגבלה</p>
        </div>

        <div className='flex flex-col gap-2'>
          <button
            type='button'
            className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            onClick={() => {
              window.open('/api/payments/upgrade?source=quota_paywall', '_blank', 'noopener,noreferrer')
              onClose()
            }}
          >
            שדרג עכשיו
          </button>
          <button
            type='button'
            className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            onClick={onClose}
          >
            מאוחר יותר
          </button>
        </div>
      </div>
      ) : null}
    </BottomSheet>
  )
}
