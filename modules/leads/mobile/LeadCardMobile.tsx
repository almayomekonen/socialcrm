'use client'

import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { statusStyle } from '@/lib/leads/statusStyles'
import type { MobileLeadRow } from '@/modules/leads/queries'
import useLongPress from '@/components/mobile/useLongPress'
import LeadContactActions from './LeadContactActions'
import { type FollowUpBadge } from './followUpBadge'

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
}: {
  lead: MobileLeadRow
  followUp: FollowUpBadge | null
  /** Pre-formatted relative time, e.g. "לפני 3 שעות". Computed on the server. */
  recency?: string
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
  onEnterSelection?: () => void
}) {
  const status = statusStyle(lead.status)
  const longPress = useLongPress(onEnterSelection ?? (() => {}), Boolean(onEnterSelection) && !selecting)

  const urgency: { label: string; tone: 'error' | 'warning' } | null = followUp
    ? { label: followUp.label, tone: followUp.tone }
    : lead.severity != null && lead.severity >= 2
      ? { label: 'ממתין זמן רב', tone: 'error' }
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
          {status.label}
        </span>

        {urgency ? (
          <span className={`inline-flex min-w-0 items-center gap-1 text-[11.5px] font-medium ${urgencyText}`}>
            <span aria-hidden className={`size-1 shrink-0 rounded-full ${urgencyDot}`} />
            <span className='truncate'>{urgency.label}</span>
          </span>
        ) : (
          lead.nextAction && <span className='truncate text-[11.5px] text-gray-500'>{lead.nextAction}</span>
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

      {!selecting && <LeadContactActions leadId={lead.id} phone={lead.phone} name={lead.name} />}
    </div>
  )
}
