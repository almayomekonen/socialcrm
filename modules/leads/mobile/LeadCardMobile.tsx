'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { leadStatusLabel, statusStyle } from '@/lib/leads/statusStyles'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import type { MobileLeadRow } from '@/modules/leads/queries'
import useLongPress from '@/components/mobile/useLongPress'
import LeadContactActions from './LeadContactActions'
import { type FollowUpBadge } from './followUpBadge'

/** The SQL `nextAction` sentence (db/clients.ts) → its catalog key; Hebrew shows the sentence itself. */
const NEXT_ACTION_KEY: Record<string, MessageKey> = {
  'התקשר עכשיו': 'leads.table.nextAction.new',
  'עקוב אחרי': 'leads.table.nextAction.contacted',
  'סגור עסקה': 'leads.table.nextAction.interested',
}

/**
 * One lead, as a phone row.
 *
 * The card body is one `Link`, and the contact actions are siblings of it,
 * never children. Long press on the link enters selection — never deletes.
 * Selection keeps the same Link (preventDefault + toggle) so the leftover
 * click after a hold cannot remount the row and immediately deselect it.
 */
export default function LeadCardMobile({
  lead,
  followUp,
  recency,
  selecting = false,
  selected = false,
  onToggle,
  onEnterSelection,
  whatsappConnected,
}: {
  lead: MobileLeadRow
  followUp: FollowUpBadge | null
  /** Pre-formatted relative time, e.g. "לפני 3 שעות". Computed on the server. */
  recency?: string
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
  onEnterSelection?: () => void
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const t = useT()
  const status = statusStyle(lead.status)
  // An unknown code is drawn as `new` (statusStyle), so it is worded as `new` too.
  const statusLabel = t.locale === 'he' ? status.label : leadStatusLabel(lead.status, t.locale) ?? leadStatusLabel('new', t.locale)
  const nextAction = lead.nextAction && t.locale !== 'he' && NEXT_ACTION_KEY[lead.nextAction] ? t(NEXT_ACTION_KEY[lead.nextAction]) : lead.nextAction
  const longPress = useLongPress(onEnterSelection ?? (() => {}), Boolean(onEnterSelection) && !selecting)

  const urgency: { label: string; tone: 'error' | 'warning' } | null = followUp
    ? { label: followUp.label, tone: followUp.tone }
    : lead.severity != null && lead.severity >= 2
      ? { label: t('leads.mobile.list.longWait'), tone: 'error' }
      : null

  const urgencyText = urgency?.tone === 'error' ? 'text-error-text' : 'text-warning-text'
  const urgencyDot = urgency?.tone === 'error' ? 'bg-error-text' : 'bg-warning-text'

  const body = (
    <>
      <div className='flex items-center gap-1.5'>
        {lead.isNewBadge && <span aria-hidden className='size-1.5 shrink-0 rounded-full bg-primary' />}
        <span className='truncate text-[15px] font-semibold leading-tight text-ink'>{lead.name}</span>
        {recency && (
          <span className='ms-auto shrink-0 text-[11px] tabular-nums leading-tight text-gray-400'>{recency}</span>
        )}
      </div>

      <div className='mt-1 flex items-center gap-1.5'>
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${status.text}`}>
          <span aria-hidden className={`size-1 shrink-0 rounded-full ${status.dot}`} />
          {statusLabel}
        </span>

        {urgency ? (
          <span className={`inline-flex min-w-0 items-center gap-1 text-[11.5px] font-medium ${urgencyText}`}>
            <span aria-hidden className={`size-1 shrink-0 rounded-full ${urgencyDot}`} />
            <span className='truncate'>{urgency.label}</span>
          </span>
        ) : (
          nextAction && <span className='truncate text-[11.5px] text-gray-500'>{nextAction}</span>
        )}
      </div>
    </>
  )

  return (
    <div className={`flex items-center gap-2.5 px-3.5 ${selected ? 'bg-primary-tint' : ''}`}>
      <Link
        href={`/clients/${lead.id}/summary` as Route}
        prefetch={false}
        data-testid='lead-row'
        data-lead-id={lead.id}
        aria-pressed={selecting ? selected : undefined}
        className={`press min-w-0 flex-1 rounded py-2.5 select-none [-webkit-touch-callout:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          selecting ? 'flex min-h-11 items-center gap-2.5 text-start' : ''
        }`}
        {...longPress}
        onClick={
          selecting
            ? (e) => {
                e.preventDefault()
                onToggle?.()
              }
            : undefined
        }
      >
        {selecting && (
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
              selected ? 'bg-primary text-white' : 'bg-gray-100'
            }`}
          >
            {selected ? <Icon name='check' type='sol' className='size-5 bg-white' /> : null}
          </span>
        )}
        <span className='min-w-0 flex-1'>{body}</span>
      </Link>

      {!selecting && (
        <LeadContactActions
          leadId={lead.id}
          phone={lead.phone}
          name={lead.name}
          whatsappConnected={whatsappConnected}
        />
      )}
    </div>
  )
}
