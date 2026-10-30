'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { failureIn, skipReasonIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { formatLeadDateTime } from '@/lib/leads/leadDate'

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
const DELIVERY: Record<string, MessageKey> = {
  sent: 'admin.automations.log.delivery.sent',
  delivered: 'admin.automations.log.delivery.delivered',
  bounced: 'admin.automations.log.delivery.bounced',
  failed: 'admin.automations.log.delivery.failed',
}

/** `subject` is the automation's own text (what the business wrote), shown as stored. */
function describe(row: ActivityRow, t: Translator): { role: StatusRole; label: string; text: string } {
  if (row.kind === 'sent') {
    const key = DELIVERY[row.deliveryState ?? 'sent']
    return { role: 'success', label: t(key ?? 'admin.automations.log.delivery.sent'), text: row.subject ?? '' }
  }
  if (row.kind === 'would_send') {
    // ADR-009 required copy — never "נשלח".
    return { role: 'info', label: t('admin.automations.log.wouldSend'), text: row.subject ?? '' }
  }
  if (row.kind === 'failed') {
    return { role: 'error', label: t('admin.automations.log.failed'), text: failureIn('terminal', t.locale) }
  }
  const reason = row.skipReason
  return { role: 'neutral', label: t('admin.automations.log.notSent'), text: (reason && skipReasonIn(reason, t.locale)) || t('admin.automations.log.notSent') }
}

/** Hebrew keeps its formatter; other languages use the shared lead date-time (BUSINESS_TZ). */
const formatWhen = (iso: string, t: Translator) =>
  t.locale === 'he'
    ? new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : formatLeadDateTime(t.locale, iso)

export default function ActivityLogModal({
  name,
  rows,
  onClose,
}: {
  name: string
  rows: ActivityRow[]
  onClose: () => void
}) {
  const t = useT()
  return (
    <ModalPop open onClose={onClose} pos='top' label={t('admin.automations.log.title', { name })} translated>
      <div className='grid gap-4 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{t('admin.automations.log.title', { name })}</h2>

        {rows.length === 0 ? (
          <div className='border rounded-md bg-gray-50 p-6 text-center grid gap-1'>
            <p className='text-sm font-medium text-gray-700'>{t('admin.automations.log.empty')}</p>
            <p className='text-sm text-gray-500'>{t('admin.automations.log.emptyBody')}</p>
          </div>
        ) : (
          <ul className='grid gap-2 max-h-[60vh] overflow-y-auto'>
            {rows.map((row) => {
              const d = describe(row, t)
              return (
                <li key={row.id} className='border rounded-md bg-white p-3 grid gap-1'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium text-gray-800'>{row.leadName || t('admin.automations.log.lead')}</span>
                    <StatusBadge role={d.role} label={d.label} size='xs' />
                  </div>
                  <p className='text-sm text-gray-600'>{d.text}</p>
                  <time className='text-xs text-gray-400' dateTime={row.occurredAt}>
                    {formatWhen(row.occurredAt, t)}
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
