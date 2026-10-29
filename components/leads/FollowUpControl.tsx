'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { setLeadFollowUp, clearLeadFollowUp } from '@/actions/leadFollowUp'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import { daysFromNow } from '@/lib/dates'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { placeFollowUpMenu } from '@/lib/leads/placeFollowUpMenu'
import { useCanTopLayer, useTopLayerPromotion } from '@/lib/useTopLayer'

type Props = {
  leadId: number
  current?: string | Date | null
  compact?: boolean
}

const PRESETS: { key: string; lbl: MessageKey; days: number }[] = [
  { key: 'tomorrow', lbl: 'leadDetail.followUp.tomorrow', days: 1 },
  { key: '3days', lbl: 'leadDetail.followUp.in3Days', days: 3 },
  { key: 'week', lbl: 'leadDetail.followUp.inWeek', days: 7 },
]

/** Menu items align to the reading start: right in Hebrew/Arabic (the legacy class), left in English. */
const ALIGN = { rtl: 'text-right', ltr: 'text-left' } as const

function isErr(res: unknown): res is { err: true; msg: string } {
  return !!res && typeof res === 'object' && 'err' in res && (res as { err?: unknown }).err === true
}

function localISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function FollowUpControl({ leadId, current, compact }: Props) {
  const t = useT()
  // Shared widget (lead summary, meeting dialog); the menu is portalled to <body>,
  // outside every language region, so it declares its own.
  const region = useRegionAttrs()
  const align = ALIGN[dirFor(t.locale)]
  const itemCls = `${align} rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50`
  const router = useRouter()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  /**
   * This menu is opened from inside a dialog (MeetingDetailsDialog), and
   * ModalPop's scrim lives in the browser's TOP LAYER — which paints above
   * every ordinary stacking context, so the z-index below cannot reach it. See
   * `lib/useTopLayer.ts`. `open` and `pos` are set in the same handler, so they
   * flip in the commit that mounts the menu and the promotion finds its node.
   */
  const canTopLayer = useCanTopLayer()
  const [pending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useTopLayerPromotion(menuRef, canTopLayer && open && pos !== null)

  function openMenu() {
    const el = wrapRef.current
    if (!el) return
    setPos(placeFollowUpMenu(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setCustom(false)
  }

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }

    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function apply(at: Date) {
    startTransition(async () => {
      const res = await setLeadFollowUp({ id: leadId, at: at.toISOString() })
      if (isErr(res)) return toast('error', res.msg)
      // Activation milestone, DESKTOP half. The same `lead_action_taken` the
      // mobile sheets emit — one event, `surface` as a prop — so the 7-day
      // activation KPI covers both devices. Emitted only after the server action
      // succeeded, never on click. Fire-and-forget: analytics never blocks a lead.
      recordLeadActionEvent('lead_action_taken', { surface: 'desktop', action: 'follow_up', leadId }).catch(() => {})
      toast('success', t('leadDetail.followUp.toastSet', { date: formatLeadDate(t.locale, at) }))
      close()
      router.refresh()
    })
  }

  function clear() {
    startTransition(async () => {
      const res = await clearLeadFollowUp({ id: leadId })
      if (isErr(res)) return toast('error', res.msg)
      toast('success', t('leadDetail.followUp.toastCleared'))
      close()
      router.refresh()
    })
  }

  /**
   * TIER 2. Setting a follow-up schedules future work, so the ACTION is gated,
   * but the follow-up already on the lead is the customer's own data and stays
   * visible. The earlier version replaced the whole control with a lock, which
   * hid the very date the rep came to check.
   *
   * Compact variant (list rows, quick actions): the date renders as plain text
   * with no lock line, because one explanation per screen is enough and the
   * lead's own page carries it.
   */
  if (expired) {
    const scheduled = current ? t('leadDetail.followUp.current', { date: formatLeadDate(t.locale, current) }) : null
    if (compact) {
      return scheduled ? (
        <span className='text-xs tabular-nums text-gray-500' {...region}>{scheduled}</span>
      ) : null
    }
    return (
      <div className='grid gap-2' {...region}>
        {scheduled && <p className='text-sm tabular-nums text-gray-700'>{scheduled}</p>}
        <SubscriptionExpiredState mode='inline' source='lead_followup' feature={t('leadDetail.followUp.expired')} translated />
      </div>
    )
  }

  const label = current ? t('leadDetail.followUp.current', { date: formatLeadDate(t.locale, current) }) : t('leadDetail.followUp.set')

  return (
    <div ref={wrapRef} className='inline-flex' data-edu='lead-followup' {...region}>
      <Btn
        variant={current ? 'soft' : 'outline'}
        size={compact ? 'icon' : undefined}
        icon='calendar'
        className='tabular-nums'
        lbl={compact ? undefined : label}
        onClick={() => (open ? close() : openMenu())}
        disabled={pending}
        aria-haspopup='menu'
        aria-expanded={open}
      />

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role='menu'
            {...region}
            popover={canTopLayer ? 'manual' : undefined}
            style={{
              position: 'fixed',
              // The UA `[popover]` box, undone so this menu's own classes stay
              // authoritative: `inset: 0` would stretch it to the viewport's
              // bottom-left, and it is `display: none` until it is shown.
              // `inset` must be written before the top/left that place it.
              ...(canTopLayer ? { display: 'flex', inset: 'auto', height: 'auto', color: 'inherit' } : null),
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 100000,
            }}
            className='flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          >
            {PRESETS.map((p) => (
              <button key={p.key} type='button' role='menuitem' disabled={pending} onClick={() => apply(daysFromNow(p.days))} className={itemCls}>
                {t(p.lbl)}
              </button>
            ))}

            {!custom ? (
              <button type='button' role='menuitem' disabled={pending} onClick={() => setCustom(true)} className={itemCls}>
                {t('leadDetail.followUp.otherDate')}
              </button>
            ) : (
              <input
                type='date'
                autoFocus
                min={localISODate(new Date())}
                disabled={pending}
                className='mx-1 my-1 rounded-md border border-gray-200 px-2 py-1 text-sm'
                onChange={(e) => {
                  if (e.target.value) apply(new Date(`${e.target.value}T00:00:00`))
                }}
              />
            )}

            {current && (
              <button type='button' role='menuitem' disabled={pending} onClick={clear} className={`${align} rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50`}>
                {t('leadDetail.followUp.remove')}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
