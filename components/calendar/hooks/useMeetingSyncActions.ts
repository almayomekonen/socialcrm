'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { cancelMeeting, retrySyncMeeting, type MeetingSummaryDTO } from '@/actions/calendar'

/**
 * Retry-sync and cancel for the meeting open in the details dialog. Extracted
 * from CalendarView (architecture-rules §1/§5) with no behaviour change: same
 * Pro answer when the subscription lapsed, same busy guards, same toasts, the
 * dialog closes and the grid refreshes afterwards.
 */

type Opts = {
  expired: boolean
  proPrompt: (title: string, body: string, source: string) => void
  detail: MeetingSummaryDTO | null
  setDetail: (m: MeetingSummaryDTO | null) => void
}

export function useMeetingSyncActions({ expired, proPrompt, detail, setDetail }: Opts) {
  const router = useRouter()
  const [retryBusy, setRetryBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function handleRetry() {
    if (expired) {
      return proPrompt(
        'סנכרון יומן זמין עם Pro',
        'חידוש המנוי יחזיר את הסנכרון ליומן Google.',
        'calendar_retry_sync',
      )
    }
    if (!detail || retryBusy) return
    setRetryBusy(true)
    try {
      const result = await retrySyncMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'synced') toast('success', 'הפגישה סונכרנה')
        else if (result.syncStatus === 'reauth_required') toast('error', 'נדרש חיבור מחדש ליומן')
        else toast('error', 'הסנכרון נכשל')
      } else {
        toast('error', 'הסנכרון נכשל')
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setRetryBusy(false)
    }
  }

  async function handleCancel() {
    if (expired) {
      return proPrompt(
        'ביטול פגישות זמין עם Pro',
        'חידוש המנוי יחזיר את האפשרות לבטל פגישות.',
        'calendar_cancel',
      )
    }
    if (!detail || cancelBusy) return
    setCancelBusy(true)
    try {
      const result = await cancelMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'reauth_required') {
          toast('error', 'הפגישה בוטלה ב-CRM. נדרש חיבור מחדש ליומן.')
        } else if (result.syncStatus === 'failed') {
          toast('error', 'הפגישה בוטלה ב-CRM. מחיקה ביומן Google נכשלה.')
        } else {
          toast('success', 'הפגישה בוטלה')
        }
      } else {
        toast('error', 'ביטול הפגישה נכשל')
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setCancelBusy(false)
    }
  }

  return { retryBusy, cancelBusy, handleRetry, handleCancel }
}
