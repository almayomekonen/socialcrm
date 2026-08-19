'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import { setLeadFollowUp, clearLeadFollowUp } from '@/actions/leadFollowUp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { daysFromNow, formatDate } from '@/lib/dates'

/**
 * Follow-up sheet — `setLeadFollowUp` / `clearLeadFollowUp`, the same actions
 * the desktop control calls. Presets match FollowUpControl, plus "today" which
 * the mobile quality bar requires as a one-tap option.
 */

const PRESETS: { key: string; lbl: string; days: number }[] = [
  { key: 'today', lbl: 'היום', days: 0 },
  { key: 'tomorrow', lbl: 'מחר', days: 1 },
  { key: '3days', lbl: 'בעוד 3 ימים', days: 3 },
  { key: 'week', lbl: 'בעוד שבוע', days: 7 },
]

function isErr(res: unknown): res is { err: true; msg: string } {
  return !!res && typeof res === 'object' && 'err' in res && (res as { err?: unknown }).err === true
}

function localISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function LeadFollowUpSheet({
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
  onSaved?: (nextFollowUpAt: string | null) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [custom, setCustom] = useState(false)

  const finish = (nextFollowUpAt: string | null) => {
    setNote('')
    setCustom(false)
    onSaved?.(nextFollowUpAt)
    onClose()
    if (refresh) router.refresh()
  }

  const apply = (at: Date) => {
    startTransition(async () => {
      const res = await setLeadFollowUp({ id: leadId, at: at.toISOString(), note: note.trim() || null })
      if (isErr(res)) return toast('error', res.msg)
      recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'follow_up', leadId }).catch(() => {})
      toast('success', `נקבע מעקב ל־${formatDate(at)}`)
      finish(at.toISOString())
    })
  }

  const clear = () => {
    startTransition(async () => {
      const res = await clearLeadFollowUp({ id: leadId })
      if (isErr(res)) return toast('error', res.msg)
      recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'follow_up', leadId }).catch(() => {})
      toast('success', 'המעקב הוסר')
      finish(null)
    })
  }

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setCustom(false)
        onClose()
      }}
      title='מעקב'
    >
      <div className='flex flex-col gap-2'>
        {current && (
          <p className='mb-1 text-[13px] text-gray-500'>{`מעקב נוכחי: ${formatDate(current)}`}</p>
        )}

        <label htmlFor='followup-note' className='sr-only'>
          הערת מעקב
        </label>
        <input
          id='followup-note'
          type='text'
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='הערה (לא חובה)'
          maxLength={200}
          className='mb-1 h-11 rounded-lg border border-gray-200 bg-gray-50 px-3 text-[15px] outline-none focus:border-primary focus:bg-white'
        />

        {PRESETS.map((p) => (
          <button
            key={p.key}
            type='button'
            disabled={pending}
            onClick={() => apply(daysFromNow(p.days))}
            className='flex min-h-12 items-center rounded-lg border border-gray-200 bg-white px-4 text-start text-[15px] font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            {p.lbl}
          </button>
        ))}

        {!custom ? (
          <button
            type='button'
            disabled={pending}
            onClick={() => setCustom(true)}
            className='flex min-h-12 items-center rounded-lg border border-gray-200 bg-white px-4 text-start text-[15px] font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            תאריך אחר…
          </button>
        ) : (
          <input
            type='date'
            autoFocus
            min={localISODate(new Date())}
            disabled={pending}
            className='h-11 rounded-lg border border-gray-200 px-3 text-[15px]'
            onChange={(e) => {
              if (e.target.value) apply(new Date(`${e.target.value}T00:00:00`))
            }}
          />
        )}

        {current && (
          <button
            type='button'
            disabled={pending}
            onClick={clear}
            className='mt-1 flex min-h-12 items-center rounded-lg px-4 text-start text-[15px] font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            הסר מעקב
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
