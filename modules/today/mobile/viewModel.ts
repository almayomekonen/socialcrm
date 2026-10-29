import type { TodaySnapshot } from '@/modules/today/queries'
import { reasonForDueRow } from '@/modules/today/queries'
import { recommendReasonCode } from '@/lib/leads/recommend'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { ReasonCode, WindowState } from '@/lib/today/types'
import { toneForReason, toneForWindow, type TodayReasonTone } from './reasonTone'
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
  eyebrow?: string
  windowHint?: string | null
  cta?: 'call' | 'open_conversation'
}

/** Tones resolved on the server from codes (reason code, WhatsApp window state). */
export type MobileTodayTones = { tone: TodayReasonTone; windowTone: TodayReasonTone }

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
  /**
   * Per-row tones by row id, resolved from CODES so no row's text is ever read.
   * Kept beside the rows (not in them) so the row shape is unchanged. A model
   * without it (hand-built) falls back to the legacy Hebrew-text tone.
   */
  tones?: Record<number, MobileTodayTones>
}

const leadHref = (id: number) => `/clients/${id}/summary`

/**
 * How many rows sit in "אחר כך", between the hero and the list.
 *
 * ONE constant, applied by ONE function, so the two pipelines cannot drift.
 */
const NEXT_UP_MAX = 2

/**
 * The shared presentation partition — the whole of the v1/v2 normalisation.
 *
 * WHAT THIS FIXES. Both pipelines already produced `{hero, nextUp, rest}`, but
 * each computed the split itself: v2 sliced one ordered list at fixed offsets,
 * while v1 took `hero`/`nextUp` from `recommended` and `rest` from a different
 * array, with no shared rule and no cap in common. Two hand-rolled partitions of
 * the same screen is exactly the kind of divergence that drifts on the next edit.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not rank, score, filter, dedupe,
 * merge or reorder. It receives lists that upstream has ALREADY ordered and
 * emits the same items, in the same order, cut into three presentation buckets:
 *
 *     [...ordered, ...overflow]  ===  [hero, ...nextUp, ...rest]
 *
 * That identity is the contract, and it is asserted directly in the tests.
 *
 * WHY `overflow` EXISTS RATHER THAN ONE CONCATENATED LIST. v1's `rest` comes from
 * `snapshot.tableRows`, a genuinely different query from `snapshot.recommended`
 * (and already disjoint from it: `tableRows = due.filter(r => !recommendedIds
 * .has(r.id))`, so no lead can appear twice). Concatenating them before the split
 * would let a `tableRows` item be promoted into "אחר כך" whenever `recommended`
 * returned fewer than three — moving an item between sections, which is a
 * behaviour change, not a normalisation. Keeping the head and the tail separate
 * makes the output byte-identical to what each pipeline produced before.
 */
function assemble(args: {
  /** Priority-ordered head. v2: every brief item. v1: `recommended` (≤ 3). */
  ordered: MobileTodayRow[]
  /** Rows that follow the head. v2: none. v1: `tableRows`. */
  overflow?: MobileTodayRow[]
  remaining: number
  restTotal: number
  doneToday: number
  meetings: number
  newLeadsCount: number
  source: MobileTodayModel['source']
  tones: Record<number, MobileTodayTones>
}): MobileTodayModel {
  const { ordered, overflow = [], ...counts } = args

  return {
    hero: ordered[0] ?? null,
    nextUp: ordered.slice(1, 1 + NEXT_UP_MAX),
    rest: [...ordered.slice(1 + NEXT_UP_MAX), ...overflow],
    ...counts,
  }
}

function tonesFor(input: { reasonCode?: ReasonCode | null; windowState?: WindowState | null }): MobileTodayTones {
  return { tone: toneForReason(input.reasonCode), windowTone: toneForWindow(input.windowState) }
}

function toRow(input: {
  id: number
  name: string | null
  phone: string | null
  reason: string
  href: string
  eyebrow?: string | null
  windowHint?: string | null
  conversationId?: number | null
}): MobileTodayRow {
  const row: MobileTodayRow = {
    id: input.id,
    name: input.name,
    phone: input.phone,
    reason: input.reason,
    href: input.href,
  }
  if (input.eyebrow) row.eyebrow = input.eyebrow
  if (input.windowHint) row.windowHint = input.windowHint
  // `cta` records that this lead HAS a conversation. It no longer decides where
  // the card navigates: the card, the name and "פתח" all open the lead itself.
  // Reaching the conversation is the WhatsApp action's job — LeadContactActions
  // already routes there via openLeadWhatsappInInbox when a channel is connected.
  if (input.conversationId) row.cta = 'open_conversation'
  return row
}

/** v2 — the Today Brief. `items` is already ordered, deduped and labelled. */
export function modelFromBrief(brief: TodayBrief, locale: UiLocale = 'he'): MobileTodayModel {
  const t = translatorFor(locale)
  const tones: Record<number, MobileTodayTones> = {}
  for (const i of brief.items) tones[i.id] = tonesFor({ reasonCode: i.state, windowState: i.windowState })
  const rows: MobileTodayRow[] = brief.items.map((i) =>
    toRow({
      id: i.id,
      name: i.name,
      phone: i.phone,
      reason: i.waitingFor ?? i.reason,
      href: leadHref(i.id),
      eyebrow: i.conversationId ? t('today.eyebrow.needsAction') : null,
      windowHint: i.windowHint,
      conversationId: i.conversationId,
    }),
  )

  return assemble({
    ordered: rows,
    remaining: brief.remaining,
    /**
     * Deliberately `rows.length`, not `brief.total`, even though the two are
     * equal today (`total: items.length`, lib/today/service.ts): the brief
     * renders every item it selected, with no server-side truncation, so the
     * rows left over after hero+nextUp ARE the true remainder. Keeping the
     * literal expression makes this value byte-identical to the previous
     * implementation rather than merely equal by a coincidence upstream could
     * change. The "מוצגים X מתוך Y" line therefore stays silent on v2 because
     * nothing is being hidden — the honest outcome, not a missing warning.
     */
    restTotal: Math.max(0, rows.length - (1 + NEXT_UP_MAX)),
    doneToday: brief.handledToday,
    meetings: brief.meetings.length,
    /**
     * v2 carries no new-lead count (`TodayBrief` has no such field), and inventing
     * one would mean a new query — out of scope and forbidden here. The clear-state
     * CTA falls back to "כל הלידים", which is true for both pipelines.
     */
    newLeadsCount: 0,
    source: 'brief_v2',
    tones,
  })
}

/** v1 — the legacy worklist. Same picks the desktop dashboard renders. */
export function modelFromSnapshot(
  snapshot: Omit<TodaySnapshot, 'hasLeads'>,
  nowMs: number,
  locale: UiLocale = 'he',
): MobileTodayModel {
  const tones: Record<number, MobileTodayTones> = {}
  for (const item of snapshot.recommended) tones[item.lead.id] = tonesFor(item)
  for (const row of snapshot.tableRows) tones[row.id] = tonesFor({ reasonCode: recommendReasonCode(row, nowMs) })
  const recommended: MobileTodayRow[] = snapshot.recommended.map((item) =>
    toRow({
      id: item.lead.id,
      name: item.lead.name,
      phone: item.lead.phone,
      reason: item.reason,
      href: leadHref(item.lead.id),
      eyebrow: item.eyebrow,
      windowHint: item.windowHint,
      conversationId: item.conversationId,
    }),
  )

  const rest: MobileTodayRow[] = snapshot.tableRows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    reason: reasonForDueRow(row, nowMs, locale),
    href: leadHref(row.id),
  }))

  /**
   * `recommended` is capped at `recommendCount` (3) upstream — `pickTopRecommended`
   * ends in `.slice(0, n)` and `mergeWaitingSpotlight` in `.slice(0, limit)` — so
   * `ordered` never exceeds three and `assemble` puts every one of its non-hero
   * entries in `nextUp`, exactly as `recommended.slice(1)` did. `tableRows` is
   * already disjoint from it, so `rest` is unchanged too.
   */
  return assemble({
    ordered: recommended,
    overflow: rest,
    remaining: snapshot.dueCount,
    restTotal: snapshot.tableTotal,
    doneToday: snapshot.doneToday,
    meetings: snapshot.meetings.length,
    newLeadsCount: snapshot.newLeadsCount,
    source: 'worklist_v1',
    tones,
  })
}
