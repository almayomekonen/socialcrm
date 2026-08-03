'use client'

import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { Btn } from '@/lib/btns/Btn'
import { automationSentence } from '@/lib/automations/sentence'
import { getAction, getEvent } from '@/lib/automations/catalog/registry'
import type { Condition } from '@/lib/automations/conditions'
import type { DefinitionStatus } from '@/db/automations/definitions'
import type { Timing } from '@/lib/automations/timing'

/**
 * One automation, legible without opening it (spec §8): outcome name, the
 * sentence, one honest state chip, one activity line, and the actions.
 */

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
}

const STATE: Record<Exclude<DefinitionStatus, 'deleted'>, { role: StatusRole; label: string }> = {
  active: { role: 'success', label: 'פעיל' },
  paused: { role: 'neutral', label: 'מושהה' },
  draft: { role: 'info', label: 'טיוטה' },
}

/**
 * The activity line is server-backed or absent — never a meaningless "0"
 * (spec §8). Observation-mode counts say so explicitly rather than claiming
 * sends that never happened (ADR-009).
 */
function activityLine(c: AutomationCardData['counts']): string | null {
  if (c.failed > 0) return `${c.failed} שליחות נכשלו השבוע`
  if (c.sent > 0) return `נשלחו ${c.sent} אימיילים השבוע`
  if (c.wouldSend > 0) return `${c.wouldSend} אימיילים היו נשלחים השבוע (מצב תצפית)`
  if (c.skipped > 0) return `${c.skipped} פעמים לא נשלח — ראו יומן פעילות`
  return null
}

type Props = {
  data: AutomationCardData
  busy?: boolean
  onEdit: () => void
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
  onActivity: () => void
}

export default function AutomationCard({ data, busy, onEdit, onToggle, onDuplicate, onDelete, onActivity }: Props) {
  const needsAttention = data.counts.failed > 0 || data.connectionProblem === true
  const state = needsAttention
    ? { role: 'error' as StatusRole, label: 'דורש טיפול' }
    : STATE[data.status as 'active' | 'paused' | 'draft']
  const line = activityLine(data.counts)
  const isActive = data.status === 'active'

  return (
    <div className='border rounded-lg bg-white p-5 grid gap-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='grid gap-1 min-w-0'>
          <h3 className='text-base font-semibold text-gray-800'>{data.name}</h3>
          <p className='text-sm text-gray-500'>
            {automationSentence({
              event: getEvent(data.eventKey),
              conditions: data.conditions,
              actionTitle: (data.actionKey ? getAction(data.actionKey) : null)?.title ?? 'פעולה',
              subject: data.subject,
              timing: data.timing,
            })}
          </p>
          {data.connectionProblem && (
            <p className='text-sm text-red-600' role='alert'>
              החיבור שהאוטומציה הזו משתמשת בו אינו פעיל. יש לחדש אותו כדי שתמשיך לפעול.
            </p>
          )}
          {line && <p className='text-sm text-gray-500'>{line}</p>}
        </div>
        <StatusBadge role={state.role} label={state.label} size='sm' />
      </div>

      <div className='flex flex-wrap gap-2'>
        <Btn
          variant='outline'
          size='small'
          lbl={isActive ? 'השהה' : 'הפעל'}
          icon={isActive ? 'pause' : 'play'}
          disabled={busy}
          onClick={onToggle}
        />
        <Btn variant='ghost' size='small' lbl='ערוך' icon='pen' disabled={busy} onClick={onEdit} />
        <Btn variant='ghost' size='small' lbl='יומן פעילות' icon='list-check' disabled={busy} onClick={onActivity} />
        <Btn variant='ghost' size='small' lbl='שכפל' icon='copy' disabled={busy} onClick={onDuplicate} />
        <Btn variant='ghost' size='small' lbl='מחק' icon='trash' disabled={busy} onClick={onDelete} className='text-red-600' />
      </div>
    </div>
  )
}
