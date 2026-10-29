'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { PRICING } from '@/lib/pricing'
import { upgradeHref } from '@/lib/entitlement/upgradeHref'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  if (!state) return null

  const isBulk = state.attempted > 1
  const canInsert = Math.max(0, state.limit - state.current)

  return (
    <ModalPop open={!!state} pos='middle' onClose={onClose} label={t('leads.quota.title')} translated>
      <div className='flex flex-col gap-5 min-w-[340px] max-w-[420px] pt-2'>
        <div>
          <p className='text-lg font-semibold whitespace-pre-line leading-snug'>
            {isBulk
              ? t('leads.quota.bulk', { attempted: String(state.attempted), remaining: String(canInsert) })
              : t('leads.quota.single', { limit: String(state.limit) })}
          </p>
          <p className='text-sm text-gray-600 mt-2'>
            {isBulk ? t('leads.quota.bulkHint') : t('leads.quota.singleHint')}
          </p>
        </div>

        <div className='bg-gray-50 border border-gray-200 rounded-lg px-4 py-3'>
          <p className='text-base font-semibold'>{t('leads.quota.plan', { price: String(PRICING.monthly) })}</p>
          {/* Monthly only. This release sells one thing, so an annual price
              here would be a number the customer cannot actually buy. */}
          <p className='text-xs text-gray-600 mt-0.5'>{t('leads.quota.unlimited')}</p>
        </div>

        <div className='flex justify-end gap-2'>
          <Btn variant='outline' lbl={t('leads.quota.later')} onClick={onClose} />
          <Btn
            variant='solid'
            lbl={t('leads.banners.upgradeNow')}
            onClick={() => {
              window.open(upgradeHref('quota_paywall'), '_blank', 'noopener,noreferrer')
              onClose()
            }}
          />
        </div>
      </div>
    </ModalPop>
  )
}
