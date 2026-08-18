import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { startOfBusinessDayMs } from '@/lib/today/time'
import type { MobileLeadRow } from '@/modules/leads/queries'
import { leadsHref, type LeadFilters } from '@/modules/leads/filters'
// Shared pure helper — imported rather than copied so the two mobile lists
// phrase "how long ago" identically. No I/O, no clock of its own: it formats
// against the `nowMs` passed down from the server.
import { relativeTimeHe } from '@/modules/inbox/mobile/relativeTime'
import LeadCardMobile from './LeadCardMobile'
import { followUpBadge } from './followUpBadge'
import LeadFilterBar from './LeadFilterBar'

/**
 * The mobile lead list — the Phase A replacement for the `/leads` handoff.
 *
 * NOT the desktop table, and not the desktop table scrolled sideways. A card
 * per lead, ordered by the SAME server-computed priority the desktop table uses
 * (`getLeadsTable`'s CTE), filtered in SQL, paginated by URL.
 *
 * Server Component. The business-day boundary is computed ONCE here, on the
 * server, in BUSINESS_TZ, and passed down — no card reads a clock, so there is
 * no timezone disagreement to hydrate into (architecture-rules.md §11).
 *
 * THREE DISTINCT STATES, never conflated (ux-guidelines.md §11):
 *   · workspace empty  → first-run guidance
 *   · filtered empty   → filters stay visible, with a clear way out
 *   · data             → the list
 */
export default function LeadListMobile({
  rows,
  filters,
  hasMore,
  page,
  workspaceEmpty,
  nowMs,
}: {
  rows: MobileLeadRow[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  workspaceEmpty: boolean
  nowMs: number
}) {
  // The workspace has no leads at all — a different situation from "your filter
  // matched nothing", and it gets different copy and a different action.
  if (workspaceEmpty) return <LeadsFirstRunMobile />

  const dayStart = startOfBusinessDayMs(nowMs)

  return (
    <div className='flex min-h-full flex-col'>
      <LeadFilterBar filters={filters} resultCount={rows.length} />

      {rows.length === 0 ? (
        <FilteredEmpty filters={filters} />
      ) : (
        <>
          {/*
            A GROUPED CARD ON THE TINTED PAGE, matching היום exactly
            (`rounded-xl border border-gray-200 bg-white` over `--color-bg`).
            The first version was an edge-to-edge white sheet, which is why the
            two screens read as different products side by side. This is the same
            container היום already uses for its row sections — adopted, not
            invented.
          */}
          <div className='mx-3 mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white'>
            <ul className='divide-y divide-gray-100'>
              {rows.map((lead) => (
                <li key={lead.id}>
                  <LeadCardMobile
                    lead={lead}
                    followUp={followUpBadge(lead.nextFollowUpAt, nowMs, dayStart)}
                    /* "When did something last happen" — the one question the old
                       card left unanswered. Formatted on the server. */
                    recency={relativeTimeHe(lead.lastActivityAt ?? lead.createdAt, nowMs)}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* Pagination is a link, not an infinite scroller: it keeps the page
              in the URL, so back/forward and refresh land where the rep was. */}
          <div className='flex items-center justify-between gap-3 px-4 py-4'>
            {page > 1 ? (
              <PageLink filters={filters} page={page - 1} label='הקודם' />
            ) : (
              <span aria-hidden className='min-h-11' />
            )}
            <span className='text-[12px] tabular-nums text-gray-400'>{`עמוד ${page}`}</span>
            {hasMore ? <PageLink filters={filters} page={page + 1} label='הבא' /> : <span aria-hidden className='min-h-11' />}
          </div>
        </>
      )}
    </div>
  )
}

function PageLink({ filters, page, label }: { filters: LeadFilters; page: number; label: string }) {
  const href = `${leadsHref(filters)}${leadsHref(filters).includes('?') ? '&' : '?'}page=${page}`
  return (
    <Link
      href={href as Route}
      className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-4 text-[14px] font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      {label}
    </Link>
  )
}

/**
 * Filters matched nothing. The filter bar above stays mounted, so the user can
 * see WHY the screen is empty and undo it in one tap — the difference between
 * "no results" and "the product is broken".
 */
function FilteredEmpty({ filters }: { filters: LeadFilters }) {
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='magnifying-glass' type='reg' className='size-5 bg-gray-400' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-base font-bold text-ink'>לא נמצאו לידים</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>
          {filters.q ? `אין תוצאות עבור "${filters.q}".` : 'אין לידים בסטטוסים שנבחרו.'}
        </p>
      </div>
      <Link
        href={'/leads' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        נקה סינון
      </Link>
    </div>
  )
}

/**
 * No leads in the workspace at all. Mirrors the intent of the desktop
 * `LeadsFirstRun` — connect a source, because that is the action that makes
 * leads arrive by themselves — without porting its four-card grid. Adding and
 * importing are Phases 8/C and are named as desktop work rather than offered as
 * buttons that do not exist yet.
 */
function LeadsFirstRunMobile() {
  return (
    <div className='flex flex-col items-center gap-5 px-6 py-14 text-center'>
      <span className='flex size-14 items-center justify-center rounded-2xl bg-primary-tint'>
        <Icon name='plug' type='sol' className='size-6 bg-primary' />
      </span>
      <div className='max-w-[320px]'>
        <h2 className='text-lg font-bold leading-tight text-ink'>עוד אין לידים במערכת</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          חברו את וואטסאפ או את פייסבוק ואינסטגרם, וכל ליד חדש יופיע כאן אוטומטית.
        </p>
      </div>
      <Link
        href={'/settings/integrations' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        חבר מקור לידים
      </Link>
      <p className='text-[12px] text-gray-400'>ייבוא מאקסל והוספה ידנית זמינים כרגע במחשב</p>
    </div>
  )
}
