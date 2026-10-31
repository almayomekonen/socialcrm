'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import { updateLead } from '@/actions/clients'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { STATUS_STYLES, leadStatusLabel, statusStyle } from '@/lib/leads/statusStyles'
import { useT } from '@/lib/i18n/I18nProvider'
import { LEAD_STATUSES } from '@/modules/leads/filters'

/**
 * Status picker — the existing `updateLead` mutation, presented as a sheet.
 *
 * No second write path. The five statuses are the product vocabulary; unknown
 * values cannot be chosen because the list is the `LEAD_STATUSES` exhaustiveness
 * check, not a free-text field.
 */
export default function LeadStatusSheet({
  open,
  onClose,
  leadId,
  current,
  refresh = true,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  leadId: number
  current: string | null
  /** Detail keeps the existing refresh. List selection patches locally instead. */
  refresh?: boolean
  onSaved?: (status: string) => void
}) {
  const router = useRouter()
  const t = useT()
  const [pending, startTransition] = useTransition()

  const pick = (status: string) => {
    if (status === current) {
      onClose()
      return
    }
    startTransition(async () => {
      try {
        await updateLead({ id: leadId, status })
        recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'status', leadId }).catch(() => {})
        toast('success', t('leads.table.statusUpdated'))
        onSaved?.(status)
        onClose()
        if (refresh) router.refresh()
      } catch {
        toast('error', t('leads.mobile.status.failed'))
      }
    })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('leads.table.header.status')} translated>
      <div className='flex flex-col gap-2'>
        {LEAD_STATUSES.map((s) => {
          const on = s === current
          const style = STATUS_STYLES[s] ?? statusStyle(s)
          return (
            <button
              key={s}
              type='button'
              onClick={() => pick(s)}
              disabled={pending}
              aria-pressed={on}
              className={`flex min-h-12 items-center gap-3 rounded-lg border px-4 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
                on ? 'border-primary bg-primary-tint' : 'border-gray-200 bg-white'
              }`}
            >
              <span className={`size-2.5 rounded-full ${style.dot}`} />
              <span className='flex-1 text-[15px] font-medium text-ink'>{t.locale === 'he' ? style.label : leadStatusLabel(s, t.locale)}</span>
              {on && <Icon name='check' type='sol' className='size-4 bg-primary' />}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
