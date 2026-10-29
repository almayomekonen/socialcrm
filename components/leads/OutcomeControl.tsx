'use client'

import { useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { logLeadOutcome } from '@/actions/leadOutcome'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import type { LeadOutcome } from '@/lib/leads/outcomeRules'
import { useFloatingMenu } from '@/lib/useFloatingMenu'
import { formatDate } from '@/lib/dates'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { formatDate as formatLocaleDate } from '@/lib/i18n/format'
import { BUSINESS_TZ } from '@/lib/today/constants'

const OUTCOMES: { outcome: LeadOutcome; lbl: MessageKey; variant: 'outline' | 'ghost' }[] = [
  { outcome: 'call_no_answer', lbl: 'leads.outcome.noAnswer', variant: 'outline' },
  { outcome: 'call_reached', lbl: 'leads.outcome.reached', variant: 'outline' },
  { outcome: 'call_interested', lbl: 'leads.outcome.interested', variant: 'outline' },
  { outcome: 'call_not_interested', lbl: 'leads.outcome.notInterested', variant: 'ghost' },
]

function isErr(res: unknown): res is { err: true; msg: string } {
  return !!res && typeof res === 'object' && 'err' in res && (res as { err?: unknown }).err === true
}

/** Hebrew keeps its exact legacy date format; other locales format in the business timezone. */
function followUpDate(t: Translator, at: string | Date): string {
  return t.locale === 'he' ? formatDate(at) : formatLocaleDate(t.locale, at, BUSINESS_TZ, 'short')
}

function outcomeToast(t: Translator, outcome: LeadOutcome, lead: { nextFollowUpAt?: string | Date | null }): string {
  const date = lead.nextFollowUpAt ? followUpDate(t, lead.nextFollowUpAt) : null
  switch (outcome) {
    case 'call_no_answer':
      return date ? t('leads.outcome.toast.noAnswerOn', { date }) : t('leads.outcome.toast.noAnswer')
    case 'call_reached':
      return date ? t('leads.outcome.toast.reachedOn', { date }) : t('leads.outcome.toast.reached')
    case 'call_interested':
      return date ? t('leads.outcome.toast.interestedOn', { date }) : t('leads.outcome.toast.interested')
    case 'call_not_interested':
      return t('leads.outcome.toast.notInterested')
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
  const t = useT()
  // The compact menu is portalled to <body>, outside every language region.
  const region = useRegionAttrs()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const menu = useFloatingMenu()

  function log(o: (typeof OUTCOMES)[number]) {
    startTransition(async () => {
      const res = await logLeadOutcome({ id: leadId, outcome: o.outcome })
      if (isErr(res)) return toast('error', res.msg)
      // Activation milestone, DESKTOP half — see FollowUpControl for the
      // one-event/`surface`-prop rationale. Post-success only.
      recordLeadActionEvent('lead_action_taken', { surface: 'desktop', action: 'outcome', leadId }).catch(() => {})
      const lead = res as { nextFollowUpAt?: string | Date | null }
      toast('success', outcomeToast(t, o.outcome, lead))
      menu.close()
      onCompleted?.()
      router.refresh()
    })
  }

  if (!compact) {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-gray-500'>{t('leads.outcome.titleLabel')}</span>
        {OUTCOMES.map((o) => (
          <Btn key={o.outcome} variant={o.variant} size='small' lbl={t(o.lbl)} disabled={pending} onClick={() => log(o)} />
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
        aria-label={t('leads.outcome.logAria')}
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
            {...region}
            style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, width: menu.pos.width, zIndex: 100000 }}
            className='flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          >
            <span className='px-3 pt-1 pb-0.5 text-[11px] text-gray-400'>{t('leads.outcome.title')}</span>
            {OUTCOMES.map((o) => (
              <button
                key={o.outcome}
                type='button'
                role='menuitem'
                disabled={pending}
                onClick={() => log(o)}
                className={`text-start rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 ${
                  o.variant === 'ghost' ? 'text-red-600 hover:bg-red-50' : ''
                }`}
              >
                {t(o.lbl)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
