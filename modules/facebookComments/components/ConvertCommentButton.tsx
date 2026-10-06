'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { toast } from '@/lib/toast'
import { convertCommentToLead } from '../actions'

/**
 * The ליד slot of one comment card: "המר לליד" while the comment has no ליד,
 * "פתח ליד" once it is linked. ONE component for both, rendered at the same place
 * in the row, so the outcome of a click survives the page refresh the action
 * triggers (its revalidatePath re-renders the list with the comment converted).
 *
 * Success is confirmed only by the action's result — never optimistically — and
 * says which of the two happened: a new ליד, or a link to one that already
 * existed. A failure stays next to the button, which stays available to retry.
 * Pending state is local, and a second click while the first is in flight sends
 * nothing (frontend-experience §7); the server is idempotent regardless.
 *
 * ACCESSIBILITY: the `role='status'` region is mounted in every state and only
 * its content changes, so the confirmation is announced (a live region inserted
 * together with its text often is not). The clicked button disappears on
 * success, so focus moves to "פתח ליד" instead of falling to the page.
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
  // The ליד may exist with the link unsaved; a retry adopts it, so do not claim "not created".
  db_error: 'לא הצלחנו להשלים את יצירת הליד. נסה שוב.',
}
const THROWN_COPY = 'לא הצלחנו להשלים את יצירת הליד. בדוק את החיבור ונסה שוב.'

type Outcome = { kind: 'created' | 'existing'; leadId: number } | { kind: 'error'; message: string }

const leadHref = (leadId: number) => `/clients/${leadId}/summary`
const successCopy = (kind: 'created' | 'existing') => (kind === 'created' ? 'הליד נוצר בהצלחה' : 'התגובה כבר מקושרת לליד קיים')
// "פתח ליד" is navigation (a real <a>), drawn like the outline Btn beside it.
const linkCls =
  'inline-flex h-9 items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

export default function ConvertCommentButton({
  commentId,
  convertedLeadId = null,
  leavesViewOnConvert = false,
}: {
  commentId: string
  /** The ליד this comment is already linked to, from the server; null while it has none. */
  convertedLeadId?: number | null
  /** True when the current list excludes converted comments, so this row will disappear. */
  leavesViewOnConvert?: boolean
}) {
  const router = useRouter()
  /*
    A lapsed subscription never throws out of `convertCommentToLead`: `upsertLead`
    catches its own entitlement guard and returns an error result, which becomes
    `create_failed`. So the locked state is recognised from `accessDenied` (seeded
    client-side). Enforcement is intact: creation routes through `upsertLead`.
  */
  const { loading, run, error, accessDenied } = useAction()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const inFlight = useRef(false)
  const openLeadRef = useRef<HTMLAnchorElement>(null)

  const success = outcome && outcome.kind !== 'error' ? outcome : null
  useEffect(() => {
    if (success) openLeadRef.current?.focus()
  }, [success])

  if (accessDenied) {
    // Opening an existing ליד stays available on a lapsed subscription; creating one does not.
    if (!convertedLeadId && !success) {
      return <SubscriptionExpiredState mode='inline' source='convert_comment' feature='חידוש המנוי מחזיר את המרת התגובות לליד' />
    }
  }

  // A thrown action (network, server crash) reaches `error` via useAction.
  const failure = outcome?.kind === 'error' ? outcome.message : error ? THROWN_COPY : null

  const onClick = () => {
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
          const leadId = result.leadId
          setOutcome({ kind, leadId })
          if (leavesViewOnConvert) toast('success', `${successCopy(kind)} · פתח ליד`, 8000, () => router.push(leadHref(leadId)))
          return
        }
        const reason = 'reason' in result ? result.reason : undefined
        setOutcome({ kind: 'error', message: (reason && FAILURE_COPY[reason]) || FAILURE_COPY.create_failed })
      } finally {
        inFlight.current = false
      }
    })
  }

  return (
    <span className='inline-flex flex-wrap items-center gap-x-2 gap-y-1'>
      {!success && convertedLeadId && (
        <Link href={leadHref(convertedLeadId)} className={linkCls}>
          פתח ליד
        </Link>
      )}
      {!success && !convertedLeadId && (
        <Btn
          lbl={loading ? 'ממיר לליד...' : 'המר לליד'}
          icon={loading ? 'spinner' : undefined}
          iconClassName={loading ? 'animate-spin' : undefined}
          size='small'
          className='w-fit'
          disabled={loading}
          onClick={onClick}
        />
      )}
      {/* Always mounted (never display:none), so screen readers announce what appears in it. */}
      <span role='status' className='inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        {success && (
          <>
            <span className='font-medium text-green-700'>{successCopy(success.kind)}</span>
            <Link ref={openLeadRef} href={leadHref(success.leadId)} className={linkCls}>
              פתח ליד
            </Link>
          </>
        )}
      </span>
      {failure && (
        <span role='alert' className='text-xs text-red-600'>
          {failure}
        </span>
      )}
    </span>
  )
}
