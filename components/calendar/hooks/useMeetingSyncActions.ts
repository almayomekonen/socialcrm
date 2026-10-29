'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { cancelMeeting, retrySyncMeeting, type MeetingSummaryDTO } from '@/actions/calendar'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Retry-sync and cancel for the meeting open in the details dialog. Extracted
 * from CalendarView (architecture-rules §1/§5) with no behaviour change: same
 * Pro answer when the subscription lapsed, same busy guards, same toasts, the
 * dialog closes and the grid refreshes afterwards. Copy follows the interface
 * language (Hebrew outside a provider); results are read by code.
 */

type Opts = {
  expired: boolean
  proPrompt: (title: string, body: string, source: string) => void
  detail: MeetingSummaryDTO | null
  setDetail: (m: MeetingSummaryDTO | null) => void
}

export function useMeetingSyncActions({ expired, proPrompt, detail, setDetail }: Opts) {
  const router = useRouter()
  const t = useT()
  const [retryBusy, setRetryBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [, startTransition] = useTransition()

  async function handleRetry() {
    if (expired) {
      return proPrompt(t('calendar.pro.retry.title'), t('calendar.pro.retry.body'), 'calendar_retry_sync')
    }
    if (!detail || retryBusy) return
    setRetryBusy(true)
    try {
      const result = await retrySyncMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'synced') toast('success', t('calendar.sync.retried'))
        else if (result.syncStatus === 'reauth_required') toast('error', t('calendar.sync.retryReauth'))
        else toast('error', t('calendar.sync.retryFailed'))
      } else {
        toast('error', t('calendar.sync.retryFailed'))
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setRetryBusy(false)
    }
  }

  async function handleCancel() {
    if (expired) {
      return proPrompt(t('calendar.pro.cancel.title'), t('calendar.pro.cancel.body'), 'calendar_cancel')
    }
    if (!detail || cancelBusy) return
    setCancelBusy(true)
    try {
      const result = await cancelMeeting(detail.id)
      if (result.ok === true) {
        if (result.syncStatus === 'reauth_required') {
          toast('error', t('calendar.sync.cancelReauth'))
        } else if (result.syncStatus === 'failed') {
          toast('error', t('calendar.sync.cancelGoogleFailed'))
        } else {
          toast('success', t('calendar.sync.cancelled'))
        }
      } else {
        toast('error', t('calendar.sync.cancelFailed'))
      }
      setDetail(null)
      startTransition(() => router.refresh())
    } finally {
      setCancelBusy(false)
    }
  }

  return { retryBusy, cancelBusy, handleRetry, handleCancel }
}
