'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import { updateLead } from '@/actions/clients'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { STATUS_STYLES, statusStyle } from '@/lib/leads/statusStyles'
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
}: {
  open: boolean
  onClose: () => void
  leadId: number
  current: string | null
}) {
  const router = useRouter()
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
        toast('success', 'סטטוס עודכן')
        onClose()
        router.refresh()
      } catch {
        toast('error', 'לא הצלחנו לעדכן את הסטטוס')
      }
    })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title='סטטוס'>
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
              <span className='flex-1 text-[15px] font-medium text-ink'>{style.label}</span>
              {on && <Icon name='check' type='sol' className='size-4 bg-primary' />}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
