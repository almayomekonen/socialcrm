'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/components/mobile/BottomSheet'
import { toast } from '@/lib/toast'
import { logLeadOutcome } from '@/actions/leadOutcome'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import type { LeadOutcome } from '@/lib/leads/outcomeRules'
import { formatDate } from '@/lib/dates'

/**
 * Outcome sheet — `logLeadOutcome`, the same four dispositions the desktop
 * control offers. The backend still owns status progression and follow-up
 * defaults; this file only presents the choice.
 */

const OUTCOMES: { outcome: LeadOutcome; lbl: string }[] = [
  { outcome: 'call_no_answer', lbl: 'לא ענה' },
  { outcome: 'call_reached', lbl: 'דיברנו' },
  { outcome: 'call_interested', lbl: 'מעוניין' },
  { outcome: 'call_not_interested', lbl: 'לא מעוניין' },
]

function isErr(res: unknown): res is { err: true; msg: string } {
  return !!res && typeof res === 'object' && 'err' in res && (res as { err?: unknown }).err === true
}

function outcomeToast(outcome: LeadOutcome, lead: { nextFollowUpAt?: string | Date | null }): string {
  const date = lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : null
  switch (outcome) {
    case 'call_no_answer':
      return date ? `לא הצלחת להשיג את הליד. נזכיר לך לנסות שוב ב-${date}.` : 'לא הצלחת להשיג את הליד. קבענו תזכורת לנסות שוב.'
    case 'call_reached':
      return date ? `השיחה נשמרה. הליד יחזור לרשימת המעקב ב-${date}.` : 'השיחה נשמרה.'
    case 'call_interested':
      return date ? `הליד סומן כמתעניין. נחזיר אותו למעקב ב-${date} כדי להתקדם לסגירה.` : 'הליד סומן כמתעניין.'
    case 'call_not_interested':
      return 'הליד סומן כלא רלוונטי והוסר מרשימת המעקב.'
  }
}

export default function LeadOutcomeSheet({
  open,
  onClose,
  leadId,
}: {
  open: boolean
  onClose: () => void
  leadId: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const accessDenied = useAccessDenied()

  const log = (o: (typeof OUTCOMES)[number]) => {
    startTransition(async () => {
      /**
       * `logLeadOutcome` calls `requireProductAccess()`, which THROWS on a lapsed
       * subscription — it does not return `{ err }`. Awaiting it inside
       * `startTransition` with only an `isErr(res)` check left that rejection
       * unhandled, and React surfaced it as "Minified React error #441" instead
       * of telling the customer their subscription lapsed. The catch is what
       * keeps a business state from reaching the renderer.
       */
      let res: Awaited<ReturnType<typeof logLeadOutcome>>
      try {
        res = await logLeadOutcome({ id: leadId, outcome: o.outcome })
      } catch {
        // The server is authoritative: if it refused, say why and keep the sheet.
        return toast('error', accessDenied ? 'תיעוד תוצאת שיחה מושהה — המנוי הסתיים' : 'לא הצלחנו לשמור את התוצאה')
      }
      if (isErr(res)) return toast('error', res.msg)
      recordLeadActionEvent('lead_action_taken', { surface: 'mobile', action: 'outcome', leadId }).catch(() => {})
      toast('success', outcomeToast(o.outcome, res as { nextFollowUpAt?: string | Date | null }))
      onClose()
      router.refresh()
    })
  }

  return (
    <BottomSheet open={open} onClose={onClose} title='תוצאת שיחה'>
      {accessDenied ? (
        <SubscriptionExpiredState mode='inline' source='lead_outcome_mobile' feature='תיעוד תוצאת שיחה מושהה' />
      ) : (
      <div className='flex flex-col gap-2'>
        {OUTCOMES.map((o) => (
          <button
            key={o.outcome}
            type='button'
            disabled={pending}
            onClick={() => log(o)}
            className='flex min-h-12 items-center rounded-lg border border-gray-200 bg-white px-4 text-start text-[15px] font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50'
          >
            {o.lbl}
          </button>
        ))}
      </div>
      )}
    </BottomSheet>
  )
}
