import Link from 'next/link'
import type { Route } from 'next'
import { statusStyle } from '@/lib/leads/statusStyles'
import type { MobileLeadRow } from '@/modules/leads/queries'
import LeadContactActions from './LeadContactActions'
import { type FollowUpBadge } from './followUpBadge'

/**
 * One lead, as a phone row.
 *
 * ── What the redesign fixed, and why ────────────────────────────────────────
 *
 * The first version stacked FOUR lines — name, source·owner, a row of filled
 * pills, then a "התקשר עכשיו" text link — beside two outlined action circles.
 * Rendered against real data at 390px that produced a 119px row whose middle
 * third was empty white, and only five leads fitted above the fold. Worse, every
 * row carried the same red pill, the same blue pill and the same purple link, so
 * nothing was scannable: a list where every row shouts says nothing.
 *
 * This version answers the five questions a rep actually has, in the order they
 * ask them, on TWO lines:
 *
 *   who        → the name, the only bold text in the row
 *   when       → relative time, far end of the same line, muted
 *   status     → coloured text with a status dot, secondary to the name
 *   what next  → the urgency, or the next action, as coloured text with a dot
 *   fastest    → call / WhatsApp, as one paired cluster at the end
 *
 * SOURCE AND OWNER WERE REMOVED from the row, not lost. They rendered as
 * "ידני · אלמיהו מקונן" identically on every line — pure noise at scan speed —
 * and both are one tap away on the detail screen. That is the progressive
 * disclosure this card was always documented as doing, applied properly.
 *
 * URGENCY IS A DOT PLUS TEXT, not a filled pill. Thirty filled red pills is a
 * decorative pattern; a dot beside coloured text keeps the semantics and returns
 * the row to a calm rhythm. `tone` comes from the same `followUpBadge`
 * computation the detail screen uses at full weight.
 *
 * Server Component. `severity`, `nextAction` and the follow-up label were all
 * computed server-side, and `recency` is passed in as a finished string — no row
 * reads a clock, so no business-day disagreement can hydrate
 * (architecture-rules.md §11).
 *
 * NOT nested-interactive: the card body is one `Link`, and the contact actions
 * are siblings of it, never children.
 */
export default function LeadCardMobile({
  lead,
  followUp,
  recency,
}: {
  lead: MobileLeadRow
  followUp: FollowUpBadge | null
  /** Pre-formatted relative time, e.g. "לפני 3 שעות". Computed on the server. */
  recency?: string
}) {
  // `statusStyle` never returns undefined — an unknown/legacy status falls
  // back to `new` instead of crashing the whole list.
  const status = statusStyle(lead.status)

  // One urgency line at most. The follow-up state is more specific than the
  // generic staleness flag, so it wins when both are true.
  const urgency: { label: string; tone: 'error' | 'warning' } | null = followUp
    ? { label: followUp.label, tone: followUp.tone }
    : lead.severity != null && lead.severity >= 2
      ? { label: 'ממתין זמן רב', tone: 'error' }
      : null

  const urgencyText = urgency?.tone === 'error' ? 'text-error-text' : 'text-warning-text'
  const urgencyDot = urgency?.tone === 'error' ? 'bg-error-text' : 'bg-warning-text'

  return (
    /*
      The row's vertical padding lives on the LINK, not on this wrapper.
      Measured: with `py-` on the wrapper the link's own box was only ~40px tall —
      two lines of text — so every one of the thirty rows reported a sub-44px tap
      target even though the row looked 65px tall. Moving the padding inside makes
      the link's real hit area the full row.
    */
    <div className='flex items-center gap-2.5 px-3.5'>
      <Link
        href={`/clients/${lead.id}/summary` as Route}
        prefetch={false}
        className='press min-w-0 flex-1 rounded py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        <div className='flex items-center gap-1.5'>
          {/* Arrived recently. A dot, not a second "חדש" chip beside a status
              that already says חדש — the old pill was redundant on every new
              lead, which is most of them. */}
          {lead.isNewBadge && <span aria-hidden className='size-1.5 shrink-0 rounded-full bg-primary' />}

          <span className='truncate text-[15px] font-semibold leading-tight text-ink'>{lead.name}</span>

          {/* `ms-auto` puts recency at the far edge, which is what closes the
              dead gap the old layout left across the middle of every row. */}
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
      </Link>

      <LeadContactActions leadId={lead.id} phone={lead.phone} name={lead.name} />
    </div>
  )
}
