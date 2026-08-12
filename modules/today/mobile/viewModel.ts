import type { TodaySnapshot } from '@/modules/today/queries'
import { reasonForDueRow } from '@/modules/today/queries'
import type { TodayBrief } from '@/lib/today/types'

/**
 * One shape for the mobile Today list, built from EITHER Today pipeline.
 *
 * The product has two, and which one an agency gets is a rollout decision
 * (`TODAY_BRIEF_V2` + `isTodayBriefEnabledForAgency`):
 *   · v2  — `buildTodayBrief` → `TodayBrief.items`, each already carrying a
 *           deterministic Hebrew `reason` and a target surface.
 *   · v1  — `resolveTodaySnapshot` → recommended + due worklist, reasons from
 *           `recommendReason`.
 *
 * Mobile normalises both instead of picking one. If mobile only understood v1,
 * an agency on v2 would be told to call a different person on its phone than on
 * its laptop — the two screens would disagree about the single most important
 * question the product answers. Mapping is the cheaper half of that trade.
 *
 * PURE. No I/O, no clock: `nowMs` is injected, reasons are precomputed
 * server-side, and every timestamp decision was already made upstream.
 */

export type MobileTodayRow = {
  id: number
  name: string | null
  phone: string | null
  /** Plain-Hebrew explanation, computed server-side. Rendered verbatim. */
  reason: string
  /** Where the row goes. Inbox items route to the conversation, not the lead. */
  href: string
}

export type MobileTodayModel = {
  hero: MobileTodayRow | null
  nextUp: MobileTodayRow[]
  rest: MobileTodayRow[]
  /** True total still waiting — may exceed hero+nextUp+rest (see `restTotal`). */
  remaining: number
  restTotal: number
  doneToday: number
  meetings: number
  newLeadsCount: number
  source: 'brief_v2' | 'worklist_v1'
}

const leadHref = (id: number) => `/clients/${id}/summary`

/** v2 — the Today Brief. `items` is already ordered, deduped and labelled. */
export function modelFromBrief(brief: TodayBrief): MobileTodayModel {
  const rows: MobileTodayRow[] = brief.items.map((i) => ({
    id: i.id,
    name: i.name,
    phone: i.phone,
    reason: i.reason,
    // Inbox-targeted items open the conversation; Phase 2 has no mobile inbox,
    // so they fall back to the lead, which carries the same conversation.
    href: leadHref(i.id),
  }))

  return {
    hero: rows[0] ?? null,
    nextUp: rows.slice(1, 3),
    rest: rows.slice(3),
    remaining: brief.remaining,
    restTotal: Math.max(0, rows.length - 3),
    doneToday: brief.handledToday,
    meetings: brief.meetings.length,
    newLeadsCount: 0,
    source: 'brief_v2',
  }
}

/** v1 — the legacy worklist. Same picks the desktop dashboard renders. */
export function modelFromSnapshot(snapshot: Omit<TodaySnapshot, 'hasLeads'>, nowMs: number): MobileTodayModel {
  const recommended: MobileTodayRow[] = snapshot.recommended.map(({ lead, reason }) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    reason,
    href: leadHref(lead.id),
  }))

  const rest: MobileTodayRow[] = snapshot.tableRows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    reason: reasonForDueRow(row, nowMs),
    href: leadHref(row.id),
  }))

  return {
    hero: recommended[0] ?? null,
    nextUp: recommended.slice(1),
    rest,
    remaining: snapshot.dueCount,
    restTotal: snapshot.tableTotal,
    doneToday: snapshot.doneToday,
    meetings: snapshot.meetings.length,
    newLeadsCount: snapshot.newLeadsCount,
    source: 'worklist_v1',
  }
}
