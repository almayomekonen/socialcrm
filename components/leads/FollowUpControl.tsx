'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { toast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { setLeadFollowUp, clearLeadFollowUp } from '@/actions/leadFollowUp'
import { daysFromNow, formatDate } from '@/lib/dates'
import { placeFollowUpMenu } from '@/lib/leads/placeFollowUpMenu'

type Props = {
  leadId: number
  current?: string | Date | null
  compact?: boolean
}

const PRESETS: { key: string; lbl: string; days: number }[] = [
  { key: 'tomorrow', lbl: 'מחר', days: 1 },
  { key: '3days', lbl: 'בעוד 3 ימים', days: 3 },
  { key: 'week', lbl: 'בעוד שבוע', days: 7 },
]

const itemCls = 'text-right rounded-md px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50'

function isErr(res: unknown): res is { err: true; msg: string } {
  return !!res && typeof res === 'object' && 'err' in res && (res as { err?: unknown }).err === true
}

function localISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function FollowUpControl({ leadId, current, compact }: Props) {
  const router = useRouter()
  /** Entitlement from the shared context — the same answer the server gives. */
  const expired = useAccessDenied()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const [pending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
      toast('success', `נקבע מעקב ל־${formatDate(at)}`)
      close()
      router.refresh()
    })
  }

  function clear() {
    startTransition(async () => {
      const res = await clearLeadFollowUp({ id: leadId })
      if (isErr(res)) return toast('error', res.msg)
      toast('success', 'המעקב הוסר')
      close()
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
    return <SubscriptionExpiredState mode='inline' source='lead_followup' feature='קביעת מעקב מושהית' />
  }

  const label = current ? `מעקב: ${formatDate(current)}` : 'קבע מעקב'

  return (
    <div ref={wrapRef} className='inline-flex' data-edu='lead-followup'>
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
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 100000 }}
            className='flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          >
            {PRESETS.map((p) => (
              <button key={p.key} type='button' role='menuitem' disabled={pending} onClick={() => apply(daysFromNow(p.days))} className={itemCls}>
                {p.lbl}
              </button>
            ))}

            {!custom ? (
              <button type='button' role='menuitem' disabled={pending} onClick={() => setCustom(true)} className={itemCls}>
                תאריך אחר…
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
              <button type='button' role='menuitem' disabled={pending} onClick={clear} className='text-right rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50'>
                הסר מעקב
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
