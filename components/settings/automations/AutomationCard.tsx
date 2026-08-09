'use client'

import { createPortal } from 'react-dom'
import Icon from '@/lib/Icon'
import { useFloatingMenu } from '@/lib/useFloatingMenu'
import { automationSentence } from '@/lib/automations/sentence'
import { getAction, getEvent } from '@/lib/automations/catalog/registry'
import type { Condition } from '@/lib/automations/conditions'
import type { DefinitionStatus } from '@/db/automations/definitions'
import type { Timing } from '@/lib/automations/timing'

export type AutomationCardData = {
  id: number
  name: string
  status: DefinitionStatus
  eventKey: string
  conditions: Condition[]
  subject: string
  timing: Timing
  counts: { sent: number; wouldSend: number; skipped: number; failed: number }
  /** The CATALOG action this automation runs. Read from the row, never assumed. */
  actionKey: string | null
  /** The bound connection is missing or unhealthy — never fails silently. */
  connectionProblem?: boolean
  /** ISO timestamp of the last mutation. */
  updatedAt?: string | null
}

/** 7-day volume. Observation-mode runs count as runs — they happened. */
export const runCount = (c: AutomationCardData['counts']) => c.sent + c.wouldSend

/**
 * The week in one clause. ADR-009: a run that only WOULD have been sent is
 * never reported as a send, so the two counts are named separately even though
 * `runCount` adds them. Absent when there is nothing true to say — never a "0".
 */
function activityPhrase(c: AutomationCardData['counts']): string | null {
  const parts = [
    c.sent > 0 ? `${c.sent} נשלחו` : null,
    c.wouldSend > 0 ? `${c.wouldSend} היו נשלחים` : null,
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(' · ')} השבוע` : null
}

/**
 * Relative time, Hebrew, computed from a server-provided ISO string.
 */
function updatedLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'עכשיו'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `לפני ${hours} ש׳`
  const days = Math.round(hours / 24)
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

type Props = {
  data: AutomationCardData
  busy?: boolean
  /** Milliseconds, passed from the parent so every row agrees on "now". */
  now?: number
  onEdit: () => void
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
  onActivity: () => void
}

/**
 * One installed automation, as a row in the control centre.
 *
 * The row is the quietest thing on the page on purpose: a name, one line of
 * fact, and the single control that matters. Everything else — edit, log,
 * duplicate, delete — lives behind one menu button rather than four ghost
 * buttons that appear on hover. The old row revealed all four on `group-hover`,
 * which put them out of reach of anything without a pointer.
 *
 * The sub-line reports only what is TRUE: a problem when there is one, the
 * week's sends when there were any, otherwise the state. Never a "0".
 */
export default function AutomationCard({
  data,
  busy,
  now = Date.now(),
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  onActivity,
}: Props) {
  const menu = useFloatingMenu()
  const hasError = data.counts.failed > 0 || data.connectionProblem === true
  const isActive = data.status === 'active'
  const updated = updatedLabel(data.updatedAt, now)

  const problem = hasError
    ? data.connectionProblem
      ? 'החיבור אינו פעיל'
      : `${data.counts.failed} שליחות נכשלו`
    : null

  const sub =
    data.status === 'draft'
      ? 'טיוטה'
      : [activityPhrase(data.counts), updated].filter(Boolean).join(' · ') ||
        (data.status === 'paused' ? 'מושהה' : 'פעילה')

  /*
   * The row shows a name and a fact; the sentence that says what the automation
   * actually DOES is carried for assistive tech only. Sighted users get it from
   * the sheet, but a screen reader has no hover and no glance — without this the
   * row would announce a name and a run count and nothing about the behaviour.
   */
  const sentence = automationSentence({
    event: getEvent(data.eventKey),
    conditions: data.conditions,
    actionTitle: (data.actionKey ? getAction(data.actionKey) : null)?.title ?? 'פעולה',
    subject: data.subject,
    timing: data.timing,
  })

  return (
    <div className='group/row -mx-3 flex items-center gap-3.5 rounded-[10px] px-3 py-2.5 transition-colors duration-150 hover:bg-[#f7f8fa]'>
      <button
        type='button'
        onClick={onEdit}
        disabled={busy}
        className='min-w-0 flex-1 text-start disabled:pointer-events-none'
      >
        <span
          className={`block truncate text-md font-medium ${isActive ? 'text-ink' : 'text-[#6b7a8d]'}`}
        >
          {data.name}
        </span>
        <span className={`mt-0.5 block truncate text-[13px] ${hasError ? 'text-error' : 'text-[#aab3c0]'}`}>
          {problem ? (
            <>
              <span>דורש טיפול</span>
              {` · ${problem}`}
            </>
          ) : (
            sub
          )}
        </span>
        <span className='sr-only'>{sentence}</span>
      </button>

      <div ref={menu.wrapRef} className='inline-flex flex-none'>
        <button
          type='button'
          aria-label={`פעולות · ${data.name}`}
          aria-haspopup='menu'
          aria-expanded={menu.open}
          disabled={busy}
          onClick={menu.toggle}
          className='flex size-7 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 hover:bg-[#eeeff2] focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100'
        >
          <Icon name='ellipsis' type='reg' className='size-4 bg-[#8b98a8]' />
        </button>
        {menu.open &&
          menu.pos &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={menu.menuRef}
              role='menu'
              style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, zIndex: 100000 }}
              className='flex w-40 flex-col gap-0.5 rounded-lg border border-border bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
            >
              <MenuItem onClick={() => (menu.close(), onEdit())}>ערוך</MenuItem>
              <MenuItem onClick={() => (menu.close(), onActivity())}>יומן פעילות</MenuItem>
              <MenuItem onClick={() => (menu.close(), onDuplicate())}>שכפל</MenuItem>
              <MenuItem destructive onClick={() => (menu.close(), onDelete())}>
                מחק
              </MenuItem>
            </div>,
            document.body,
          )}
      </div>

      <button
        type='button'
        aria-pressed={isActive}
        aria-label={isActive ? `השהה · ${data.name}` : `הפעל · ${data.name}`}
        title={isActive ? 'השהה' : 'הפעל'}
        disabled={busy}
        onClick={onToggle}
        className={`relative h-5 w-8.5 flex-none rounded-full transition-colors duration-150 disabled:opacity-50 ${
          isActive ? 'bg-success' : 'bg-[#e6e8ed]'
        }`}
      >
        <span
          aria-hidden='true'
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[inset-inline] duration-150 ${
            isActive ? 'end-0.5' : 'start-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function MenuItem({
  onClick,
  destructive,
  children,
}: {
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      role='menuitem'
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-start text-[13px] hover:bg-[#f7f8fa] ${
        destructive ? 'text-error' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}
