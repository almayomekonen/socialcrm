// Today brief — the single assembly point. Server-only orchestrator (the sole
// I/O module under lib/today; excluded from the purity guard). It composes facts →
// classify/order/dedupe → progress → verdict → DTO, and carries meetings as a
// separate lane (INV-14). It holds NO business rules — every rule lives in the
// pure modules it calls. `nowMs` is injected (no clock read here).

import { getBriefCandidateFacts, type Scope } from '@/db/today/facts'
import { getTouchedTodayIds } from '@/db/today/handled'
import { getInboundSyncFreshness } from '@/db/today/freshness'
import { getTodaysMeetings } from '@/db/meetings'
import { listOldestWaitingWhatsappByLeadIds } from '@/db/inboxWaiting'
import { hydrateBriefWaitingItems } from '@/modules/today/waitingSpotlight'
import { businessDayBounds, formatBusinessTime } from './time'
import { orderAndDedupe } from './classify'
import { progress, volumeStateFor } from './progress'
import { completenessVerdict } from './verdict'
import { greetingFor } from './greeting'
import type { MeetingItem, TodayBrief } from './types'

export type Viewer = { scope: Scope; agencyId: number; userId: number; firstName: string }

type MeetingRow = { id: number; title: string; start_at: Date | string }

function toMeetingItem(m: MeetingRow): MeetingItem {
  const at = m.start_at instanceof Date ? m.start_at.getTime() : new Date(m.start_at).getTime()
  if (Number.isNaN(at)) return { id: Number(m.id), title: m.title ?? null, at: 0, timeLabel: null }
  return { id: Number(m.id), title: m.title ?? null, at, timeLabel: formatBusinessTime(at) || null }
}

export async function buildTodayBrief(viewer: Viewer, nowMs: number): Promise<TodayBrief> {
  const ctx = businessDayBounds(nowMs)

  // The agency travels WITH the scope. `viewer.agencyId` is already required and
  // already server-resolved, so a sessionless caller never reaches
  // getAgencyId() -> getUser(); an interactive caller passes the same value the
  // viewer was built from, so the resolved agency — and behaviour — is identical.
  const scope = { ...viewer.scope, agencyId: viewer.agencyId }

  const [facts, touchedTodayIds, freshness, meetingsRaw] = await Promise.all([
    getBriefCandidateFacts(scope),
    getTouchedTodayIds(scope, ctx.dayStart),
    getInboundSyncFreshness(),
    getTodaysMeetings({ agencyId: viewer.agencyId, organizerUserId: viewer.userId }),
  ])

  const classified = orderAndDedupe(facts, ctx)
  const waitingLeadIds = classified.filter((i) => i.state === 'WAITING_REPLY').map((i) => i.id)
  const waiters = await listOldestWaitingWhatsappByLeadIds({
    agencyId: viewer.agencyId,
    user: viewer.scope.user,
    gotPermIds: viewer.scope.gotPermIds,
    leadIds: waitingLeadIds,
  })
  const items = hydrateBriefWaitingItems(classified, waiters, nowMs)
  const { remaining, handledToday, done } = progress({ qualifyingIds: items.map((i) => i.id), touchedTodayIds })
  const { statusVerdict, permissionVerdict } = completenessVerdict({ remaining, dataFresh: freshness.dataFresh })

  return {
    greeting: greetingFor(nowMs),
    firstName: viewer.firstName,
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
