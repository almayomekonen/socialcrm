'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { toast } from '@/lib/toast'
import { convertCommentToLead } from '../actions'

/**
 * The ליד slot of one comment row: "צור ליד" while the comment is open, "פתח ליד"
 * once it is linked. ONE component for both, rendered at the same place in the
 * row, so the outcome of a click survives the page refresh the action triggers
 * (its revalidatePath re-renders the list with the comment now converted).
 *
 * Success is confirmed only by the action's result — never optimistically — and
 * says which of the two happened: a new ליד, or a link to one that already
 * existed. A failure stays next to the button, which stays available to retry.
 * Pending state is local, and a second click while the first is in flight sends
 * nothing (frontend-experience §7); the server is idempotent regardless.
 *
 * Under a filter the comment no longer matches once converted ("פתוחות"), the
 * refresh removes the row and this confirmation with it — so there, and only
 * there, success is also confirmed by a toast that opens the ליד.
 *
 * No raw error text ever reaches here; the action returns typed reasons.
 */
const FAILURE_COPY: Record<string, string> = {
  not_found: 'התגובה לא נמצאה. רענן את הדף ונסה שוב.',
  deleted: 'התגובה נמחקה בפייסבוק, ולכן לא ניתן ליצור ממנה ליד.',
  page_authored: 'זו תגובה של הדף שלך, ולכן לא ניתן ליצור ממנה ליד.',
  not_enabled: 'יצירת לידים מתגובות אינה זמינה בחשבון הזה.',
  quota_exceeded: 'הגעת למכסת הלידים בחבילה הנוכחית. שדרג את החבילה כדי ליצור ליד מהתגובה.',
  create_failed: 'הליד לא נוצר. נסה שוב.',
  db_error: 'הליד לא נוצר. נסה שוב.',
}

type Outcome = { kind: 'created' | 'existing'; leadId: number } | { kind: 'error'; message: string }

const leadHref = (leadId: number) => `/clients/${leadId}/summary`

export default function ConvertCommentButton({
  commentId,
  convertedLeadId = null,
  leavesViewOnConvert = false,
}: {
  commentId: string
  /** The ליד this comment is already linked to, from the server; null while open. */
  convertedLeadId?: number | null
  /** True when the current list excludes converted comments, so this row will disappear. */
  leavesViewOnConvert?: boolean
}) {
  const router = useRouter()
  /*
    `convertCommentToLead` CATCHES the entitlement guard's throw and returns
    `{ ok:false, reason:'db_error' }`, so a lapsed subscription is recognised from
    `accessDenied` (seeded client-side), not from the result. Enforcement is intact:
    creation routes through `upsertLead`, which calls requireProductAccess.
  */
  const { loading, run, error, accessDenied } = useAction()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const inFlight = useRef(false)

  if (outcome && outcome.kind !== 'error') {
    return (
      <span role='status' className='inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <span className='font-medium text-green-700'>
          {outcome.kind === 'created' ? 'הליד נוצר בהצלחה' : 'התגובה כבר מקושרת לליד קיים'}
        </span>
        <Link href={leadHref(outcome.leadId)} className='font-medium text-primary underline underline-offset-2'>
          פתח ליד
        </Link>
      </span>
    )
  }

  if (convertedLeadId) {
    return (
      <Link href={leadHref(convertedLeadId)} className='text-xs font-medium text-primary underline underline-offset-2'>
        פתח ליד
      </Link>
    )
  }

  if (accessDenied) {
    return <SubscriptionExpiredState mode='inline' source='convert_comment' feature='חידוש המנוי מחזיר את המרת התגובות לליד' />
  }

  // A thrown action (network, server crash) reaches `error` via useAction.
  const failure = outcome?.kind === 'error' ? outcome.message : error ? 'הליד לא נוצר. בדוק את החיבור ונסה שוב.' : null

  return (
    <span className='inline-flex flex-wrap items-center gap-x-2 gap-y-1'>
      <Btn
        lbl={loading ? 'יוצר ליד...' : 'צור ליד'}
        icon={loading ? 'spinner' : undefined}
        iconClassName={loading ? 'animate-spin' : undefined}
        variant='outline'
        size='small'
        className='w-fit'
        disabled={loading}
        onClick={() => {
          // `run` checks its own `loading`, but that is state: two clicks in one
          // frame would both pass it. The ref closes that window.
          if (inFlight.current) return
          inFlight.current = true
          run(async () => {
            setOutcome(null)
            try {
              const result = await convertCommentToLead(commentId)
              // `in` rather than narrowing on `result.ok`: the repo compiles with
              // strictNullChecks:false, which disables discriminated-union narrowing.
              if ('leadId' in result) {
                const kind = result.created ? 'created' : 'existing'
                setOutcome({ kind, leadId: result.leadId })
                if (leavesViewOnConvert) {
                  const leadId = result.leadId
                  toast(
                    'success',
                    `${kind === 'created' ? 'הליד נוצר בהצלחה' : 'התגובה כבר מקושרת לליד קיים'} · פתח ליד`,
                    8000,
                    () => router.push(leadHref(leadId)),
                  )
                }
                return
              }
              const reason = 'reason' in result ? result.reason : undefined
              setOutcome({ kind: 'error', message: (reason && FAILURE_COPY[reason]) || FAILURE_COPY.create_failed })
            } finally {
              inFlight.current = false
            }
          })
        }}
      />
      {failure && (
        <span role='alert' className='text-xs text-red-600'>
          {failure}
        </span>
      )}
    </span>
  )
}
