import { startOfBusinessDayMs } from '@/lib/today/time'
import type { MobileLeadRow } from '@/modules/leads/queries'
import { type LeadFilters } from '@/modules/leads/filters'
import { relativeTime } from '@/modules/inbox/mobile/relativeTime'
import type { UiLocale } from '@/lib/i18n/config'
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
  whatsappConnected,
  firstImport = 0,
  firstLeadId,
  firstImportSkipped = 0,
  locale = 'he',
}: {
  rows: MobileLeadRow[]
  filters: LeadFilters
  hasMore: boolean
  page: number
  workspaceEmpty: boolean
  nowMs: number
  metaConnected?: boolean
  /**
   * Workspace WhatsApp connection.
   *
   * INTENTIONALLY UNDEFAULTED. `undefined` means "the caller does not know", and
   * `resolveLeadContactPlan` treats that as the in-app path — i.e. exactly the
   * behaviour this surface had before the native handoff existed. Defaulting it
   * to `false` would silently opt every caller that forgets the prop into the
   * handoff, including tests and any future render site, which is the wrong way
   * round for a change that routes people out of the product.
   */
  whatsappConnected?: boolean
  /** One-shot: leads that just arrived via import, and the first of them. */
  firstImport?: number
  firstLeadId?: number
  firstImportSkipped?: number
  /** The interface language, resolved once by the page (Hebrew by default). */
  locale?: UiLocale
}) {
  if (workspaceEmpty) {
    return <LeadsFirstRunMobile metaConnected={metaConnected} whatsappConnected={whatsappConnected ?? false} />
  }

  const dayStart = startOfBusinessDayMs(nowMs)
  const cards = rows.map((lead) => ({
    ...lead,
    followUp: followUpBadge(lead.nextFollowUpAt, nowMs, dayStart, locale),
    recency: relativeTime(lead.lastActivityAt ?? lead.createdAt, nowMs, locale),
  }))

  return (
    <>
      {/* Same component as desktop — one banner, one message, both surfaces.
          Sits above the list, never over it. */}
      {firstImport > 0 && (
        <div className='px-4 pt-4'>
          <FirstImportCallout count={firstImport} leadId={firstLeadId} skipped={firstImportSkipped} />
        </div>
      )}
      <LeadListMobileClient
        cards={cards}
        filters={filters}
        hasMore={hasMore}
        page={page}
        nowMs={nowMs}
        dayStartMs={dayStart}
        whatsappConnected={whatsappConnected}
      />
    </>
  )
}
