'use client'

import { useContext, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { AdsSelectionContext } from './AdsReportShell'

/**
 * "נסה שוב" for a failed Meta read: re-runs the SAME selection. Inside the report
 * shell it goes through the shell (so "מעדכן נתונים…" shows); elsewhere — e.g.
 * the account list failed before any report exists — it refreshes on its own.
 */
export default function AdsRetryButton({ lbl = 'נסה שוב' }: { lbl?: string }) {
  const shell = useContext(AdsSelectionContext)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const busy = shell ? shell.updating : pending

  return (
    <Btn
      lbl={busy ? 'טוען מחדש…' : lbl}
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
