'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { SKIP_REASON_COPY, FAILURE_COPY } from '@/lib/automations/copy'
import type { SkipReason } from '@/lib/automations/types'

/**
 * The activity log — the heart of the feature (spec §8). Every send, every
 * would-send, and every SKIP with its human reason. Surfacing the decisions
 * NOT to act is what makes the engine's proportionality visible.
 */

export type ActivityRow = {
  id: number
  leadId: number
  leadName: string | null
  kind: 'sent' | 'would_send' | 'skipped' | 'failed'
  mode: 'live' | 'log'
  skipReason: string | null
  subject: string | null
  deliveryState: string | null
  occurredAt: string
}

// Honest delivery language: "נשלח" means accepted for delivery, never proof
// of arrival (the WhatsApp sent≠delivered precedent).
const DELIVERY: Record<string, string> = {
  sent: 'נשלח',
  delivered: 'נמסר',
  bounced: 'לא נמסר',
  failed: 'נכשל',
}

function describe(row: ActivityRow): { role: StatusRole; label: string; text: string } {
  if (row.kind === 'sent') {
    return { role: 'success', label: DELIVERY[row.deliveryState ?? 'sent'] ?? 'נשלח', text: row.subject ?? '' }
  }
  if (row.kind === 'would_send') {
    // ADR-009 required copy — never "נשלח".
    return { role: 'info', label: 'היה נשלח (מצב תצפית)', text: row.subject ?? '' }
  }
  if (row.kind === 'failed') {
    return { role: 'error', label: 'נכשל', text: FAILURE_COPY.terminal }
  }
  const reason = row.skipReason as SkipReason | null
  return { role: 'neutral', label: 'לא נשלח', text: (reason && SKIP_REASON_COPY[reason]) || 'לא נשלח' }
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function ActivityLogModal({
  name,
  rows,
  onClose,
}: {
  name: string
  rows: ActivityRow[]
  onClose: () => void
}) {
  return (
    <ModalPop open onClose={onClose} pos='top' label={`יומן פעילות — ${name}`}>
      <div className='grid gap-4 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>יומן פעילות — {name}</h2>

        {rows.length === 0 ? (
          <div className='border rounded-md bg-gray-50 p-6 text-center grid gap-1'>
            <p className='text-sm font-medium text-gray-700'>אין עדיין פעילות</p>
            <p className='text-sm text-gray-500'>ברגע שהאוטומציה תפעל, כל שליחה וכל דילוג יופיעו כאן.</p>
          </div>
        ) : (
          <ul className='grid gap-2 max-h-[60vh] overflow-y-auto'>
            {rows.map((row) => {
              const d = describe(row)
              return (
                <li key={row.id} className='border rounded-md bg-white p-3 grid gap-1'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium text-gray-800'>{row.leadName || 'ליד'}</span>
                    <StatusBadge role={d.role} label={d.label} size='xs' />
                  </div>
                  <p className='text-sm text-gray-600'>{d.text}</p>
                  <time className='text-xs text-gray-400' dateTime={row.occurredAt}>
                    {formatWhen(row.occurredAt)}
                  </time>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </ModalPop>
  )
}
