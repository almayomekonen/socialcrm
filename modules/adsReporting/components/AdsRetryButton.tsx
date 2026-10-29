'use client'

import { useContext, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { AdsSelectionContext } from './AdsReportShell'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * "נסה שוב" for a failed Meta read: re-runs the SAME selection. Inside the report
 * shell it goes through the shell (so "מעדכן נתונים…" shows); elsewhere — e.g.
 * the account list failed before any report exists — it refreshes on its own.
 */
export default function AdsRetryButton({ lbl }: { lbl?: string }) {
  const t = useT()
  const shell = useContext(AdsSelectionContext)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const busy = shell ? shell.updating : pending

  return (
    <Btn
      lbl={busy ? t('performance.ads.error.reloading') : (lbl ?? t('performance.ads.retry'))}
      icon={busy ? 'spinner' : 'rotate-right'}
      iconClassName={busy ? 'animate-spin' : undefined}
      variant='outline'
      size='small'
      className='w-fit'
      disabled={busy}
      type='button'
      onClick={() => (shell ? shell.retry() : startTransition(() => router.refresh()))}
    />
  )
}
