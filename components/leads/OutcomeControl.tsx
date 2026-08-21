'use client'

import { useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { logLeadOutcome } from '@/actions/leadOutcome'
import type { LeadOutcome } from '@/lib/leads/outcomeRules'
import { useFloatingMenu } from '@/lib/useFloatingMenu'
import { formatDate } from '@/lib/dates'

const OUTCOMES: { outcome: LeadOutcome; lbl: string; variant: 'outline' | 'ghost' }[] = [
  { outcome: 'call_no_answer', lbl: 'לא ענה', variant: 'outline' },
  { outcome: 'call_reached', lbl: 'דיברנו', variant: 'outline' },
  { outcome: 'call_interested', lbl: 'מעוניין', variant: 'outline' },
  { outcome: 'call_not_interested', lbl: 'לא מעוניין', variant: 'ghost' },
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

export default function OutcomeControl({
  leadId,
  compact = false,
  onCompleted,
}: {
  leadId: number
  compact?: boolean
  onCompleted?: () => void
}) {
  const router = useRouter()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  const [pending, startTransition] = useTransition()
  const menu = useFloatingMenu()

  function log(o: (typeof OUTCOMES)[number]) {
    startTransition(async () => {
      const res = await logLeadOutcome({ id: leadId, outcome: o.outcome })
      if (isErr(res)) return toast('error', res.msg)
      const lead = res as { nextFollowUpAt?: string | Date | null }
      toast('success', outcomeToast(o.outcome, lead))
      menu.close()
      onCompleted?.()
      router.refresh()
    })
  }

  /**
   * PRE-GATE. The action behind this control is requireProductAccess-guarded
   * and the dispatch has no catch, so on a lapsed subscription the click ended
   * as an unhandled Server Action rejection — nothing happened, and nothing
   * said why.
   *
   * Full variant: the shared inline locked state takes the control's place, so
   * the block that promised an action explains itself instead.
   * Compact variant (list rows, quick actions): withheld silently. One
   * explanation per screen, not one per row — the lead stays readable and its
   * own page carries the locked state.
   */
  if (expired) {
    if (compact) return null
    return <SubscriptionExpiredState mode='inline' source='lead_outcome' feature='תיעוד תוצאת שיחה מושהה' />
  }

  if (!compact) {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-gray-500'>תוצאת שיחה:</span>
        {OUTCOMES.map((o) => (
          <Btn key={o.outcome} variant={o.variant} size='small' lbl={o.lbl} disabled={pending} onClick={() => log(o)} />
        ))}
      </div>
    )
  }

  return (
    <div ref={menu.wrapRef} className='inline-flex'>
      <Btn
        variant='outline'
        size='icon'
        icon='comment-check'
        aria-label='תיעוד תוצאת שיחה'
        onClick={menu.toggle}
        disabled={pending}
        aria-haspopup='menu'
        aria-expanded={menu.open}
      />
      {menu.open &&
        menu.pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menu.menuRef}
            role='menu'
            style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, width: menu.pos.width, zIndex: 100000 }}
            className='flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          >
            <span className='px-3 pt-1 pb-0.5 text-[11px] text-gray-400'>תוצאת שיחה</span>
            {OUTCOMES.map((o) => (
              <button
                key={o.outcome}
                type='button'
                role='menuitem'
                disabled={pending}
                onClick={() => log(o)}
                className={`text-right rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 ${
                  o.variant === 'ghost' ? 'text-red-600 hover:bg-red-50' : ''
                }`}
              >
                {o.lbl}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
