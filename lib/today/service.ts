// Today brief — the single assembly point. Server-only orchestrator (the sole
// I/O module under lib/today; excluded from the purity guard). It composes facts →
// classify/order/dedupe → progress → verdict → DTO, and carries meetings as a
// separate lane (INV-14). It holds NO business rules — every rule lives in the
// pure modules it calls. `nowMs` is injected (no clock read here).

import { getBriefCandidateFacts, type Scope } from '@/db/today/facts'
import { getTouchedTodayIds } from '@/db/today/handled'
import { getInboundSyncFreshness } from '@/db/today/freshness'
import { getTodaysMeetings } from '@/db/meetings'
import { businessDayBounds } from './time'
import { orderAndDedupe } from './classify'
import { progress, volumeStateFor } from './progress'
import { completenessVerdict } from './verdict'
import type { MeetingItem, TodayBrief } from './types'

export type Viewer = { scope: Scope; agencyId: number; userId: number }

type MeetingRow = { id: number; title: string; start_at: Date | string }

function toMeetingItem(m: MeetingRow): MeetingItem {
  const at = m.start_at instanceof Date ? m.start_at.getTime() : new Date(m.start_at).getTime()
  return { id: Number(m.id), title: m.title ?? null, at: Number.isNaN(at) ? 0 : at }
}

export async function buildTodayBrief(viewer: Viewer, nowMs: number): Promise<TodayBrief> {
  const ctx = businessDayBounds(nowMs)

  const [facts, touchedTodayIds, freshness, meetingsRaw] = await Promise.all([
    getBriefCandidateFacts(viewer.scope),
    getTouchedTodayIds(viewer.scope, ctx.dayStart),
    getInboundSyncFreshness(),
    getTodaysMeetings({ agencyId: viewer.agencyId, organizerUserId: viewer.userId }),
  ])

  const items = orderAndDedupe(facts, ctx)
  const { remaining, handledToday, done } = progress({ qualifyingIds: items.map((i) => i.id), touchedTodayIds })
  const { statusVerdict, permissionVerdict } = completenessVerdict({ remaining, dataFresh: freshness.dataFresh })

  return {
    items,
    total: items.length,
    remaining,
    handledToday,
    done,
    volumeState: volumeStateFor(remaining),
    statusVerdict,
    permissionVerdict,
    meetings: (meetingsRaw as unknown as MeetingRow[]).map(toMeetingItem),
  }
}
