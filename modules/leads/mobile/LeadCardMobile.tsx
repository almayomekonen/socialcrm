import Link from 'next/link'
import type { Route } from 'next'
import { statusStyle } from '@/lib/leads/statusStyles'
import type { MobileLeadRow } from '@/modules/leads/queries'
import LeadContactActions from './LeadContactActions'
import { type FollowUpBadge } from './followUpBadge'

/**
 * One lead, as a phone card.
 *
 * The 2-second test: identity → source → status → urgency → what's next.
 * Everything else the desktop table shows (id number, secondary phone, creator,
 * cold/stuck flags, 15 more columns) is deliberately absent — progressive
 * disclosure, with the full record one tap away on the detail screen.
 *
 * Server Component. The `severity` and `nextAction` values were computed by the
 * SQL CTE in `getLeadsTable`, and the follow-up label by `followUpLabel` on the
 * server, so nothing here reads a clock — no browser/server business-day
 * disagreement is possible (architecture-rules.md §11).
 *
 * NOT nested-interactive: the card body is one `Link`, and the contact actions
 * are siblings of it, not children. A button inside a link is an invalid,
 * untappable target on touch.
 */
export default function LeadCardMobile({ lead, followUp }: { lead: MobileLeadRow; followUp: FollowUpBadge | null }) {
  // `statusStyle` never returns undefined — an unknown/legacy status falls
  // back to `new` instead of crashing the whole list.
  const status = statusStyle(lead.status)

  return (
    <div className='flex items-start gap-3 bg-white px-4 py-3.5'>
      <Link
        href={`/clients/${lead.id}/summary` as Route}
        className='min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <div className='flex items-baseline gap-2'>
          <span className='truncate text-[15px] font-semibold leading-tight text-ink'>{lead.name}</span>
          {lead.isNewBadge && (
            <span className='shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700'>
              חדש
            </span>
          )}
        </div>

        {/* Source + owner: "where did this come from, and is it mine". */}
        <p className='mt-0.5 truncate text-[12px] leading-tight text-gray-500'>
          {lead.sourceLabel}
          {lead.handlerName ? ` · ${lead.handlerName}` : ''}
        </p>

        <div className='mt-2 flex flex-wrap items-center gap-1.5'>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
          >
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>

          {followUp && (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${followUp.className}`}
            >
              {followUp.label}
            </span>
          )}

          {/* Only when the row is genuinely overdue — severity is null otherwise. */}
          {lead.severity != null && lead.severity >= 2 && !followUp && (
            <span className='inline-flex items-center rounded-full border border-error-border bg-error-bg px-2 py-0.5 text-[11px] font-medium text-error-text'>
              ממתין זמן רב
            </span>
          )}
        </div>

        {lead.nextAction && (
          <p className='mt-1.5 truncate text-[12px] font-medium text-primary-text'>{lead.nextAction}</p>
        )}
      </Link>

      <LeadContactActions leadId={lead.id} phone={lead.phone} name={lead.name} className='pt-0.5' />
    </div>
  )
}
