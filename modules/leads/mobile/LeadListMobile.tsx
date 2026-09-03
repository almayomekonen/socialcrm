import { startOfBusinessDayMs } from '@/lib/today/time'
import type { MobileLeadRow } from '@/modules/leads/queries'
import { type LeadFilters } from '@/modules/leads/filters'
import { relativeTimeHe } from '@/modules/inbox/mobile/relativeTime'
import { followUpBadge } from './followUpBadge'
import LeadsFirstRunMobile from './LeadsFirstRunMobile'
import FirstImportCallout from '@/components/clients/FirstImportCallout'
import LeadListMobileClient from './LeadListMobileClient'

/**
 * The mobile lead list — the Phase A replacement for the `/leads` handoff.
 *
 * Server Component wrapper: follow-up badges and relative time are stamped here
 * against one `nowMs` (architecture-rules.md §11). Long-press selection lives
 * in the client island.
 */
export default function LeadListMobile({
  rows,
  filters,
  hasMore,
  page,
  workspaceEmpty,
  nowMs,
  metaConnected = false,
  whatsappConnected = false,
  firstImport = 0,
  firstLeadId,
}: {
  rows: MobileLeadRow[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  workspaceEmpty: boolean
  nowMs: number
  metaConnected?: boolean
  whatsappConnected?: boolean
  /** One-shot: leads that just arrived via import, and the first of them. */
  firstImport?: number
  firstLeadId?: number
}) {
  if (workspaceEmpty) {
    return <LeadsFirstRunMobile metaConnected={metaConnected} whatsappConnected={whatsappConnected} />
  }

  const dayStart = startOfBusinessDayMs(nowMs)
  const cards = rows.map((lead) => ({
    ...lead,
    followUp: followUpBadge(lead.nextFollowUpAt, nowMs, dayStart),
    recency: relativeTimeHe(lead.lastActivityAt ?? lead.createdAt, nowMs),
  }))

  return (
    <>
      {/* Same component as desktop — one banner, one message, both surfaces.
          Sits above the list, never over it. */}
      {firstImport > 0 && (
        <div className='px-4 pt-4'>
          <FirstImportCallout count={firstImport} leadId={firstLeadId} />
        </div>
      )}
      <LeadListMobileClient
        cards={cards}
        filters={filters}
        hasMore={hasMore}
        page={page}
        nowMs={nowMs}
        dayStartMs={dayStart}
      />
    </>
  )
}
