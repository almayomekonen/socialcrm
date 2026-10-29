// Today brief — the single assembly point. Server-only orchestrator (the sole
// I/O module under lib/today; excluded from the purity guard). It composes facts →
// classify/order/dedupe → progress → verdict → DTO, and carries meetings as a
// separate lane (INV-14). It holds NO business rules — every rule lives in the
// pure modules it calls. `nowMs` is injected (no clock read here).

import { getBriefCandidateFacts, type Scope } from '@/db/today/facts'
import { getTouchedTodayIds } from '@/db/today/handled'
import { getInboundSyncFreshness } from '@/db/today/freshness'
import { getTodaysMeetings, type TodaysMeeting } from '@/db/meetings'
import { listOldestWaitingWhatsappByLeadIds } from '@/db/inboxWaiting'
import { hydrateBriefWaitingItems } from '@/modules/today/waitingSpotlight'
import { businessDayBounds, formatBusinessLongDate, formatBusinessTime } from './time'
import { orderAndDedupe } from './classify'
import { progress, volumeStateFor } from './progress'
import { completenessVerdict } from './verdict'
import { greetingFor } from './greeting'
import type { MeetingItem, TodayBrief } from './types'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { BUSINESS_TZ } from './constants'

export type Viewer = { scope: Scope; agencyId: number; userId: number; firstName: string }

// getTodaysMeetings returns `startAt` (ISO string). This used to read a
// non-existent `start_at` through a cast, so every meeting's `at` was 0.
function toMeetingItem(m: TodaysMeeting, locale: UiLocale): MeetingItem {
  const at = new Date(m.startAt).getTime()
  const title = m.title ?? null
  const video = m.meetUrl ? translatorFor(locale)('today.meetings.video') : null
  const subtitle = [m.leadName && m.leadName !== title ? m.leadName : null, video].filter(Boolean).join(' · ') || null
  if (Number.isNaN(at)) return { id: Number(m.id), title, at: 0, timeLabel: null, subtitle }
  return { id: Number(m.id), title, at, timeLabel: formatBusinessTime(at, BUSINESS_TZ, locale) || null, subtitle }
}

/**
 * `opts.locale` is the interface language for the brief's display strings
 * (greeting, date, reasons, waiting/window copy, source chip, meeting
 * subtitle/time). It defaults to Hebrew: the MCP tool, the AI agent and the
 * mobile API pass nothing and keep their exact output. Codes (`state`,
 * `windowState`, verdicts) are locale-independent.
 */
export async function buildTodayBrief(viewer: Viewer, nowMs: number, opts: { locale?: UiLocale } = {}): Promise<TodayBrief> {
  const locale = opts.locale ?? 'he'
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

  const classified = orderAndDedupe(facts, ctx, locale)
  const waitingLeadIds = classified.filter((i) => i.state === 'WAITING_REPLY').map((i) => i.id)
  const waiters = await listOldestWaitingWhatsappByLeadIds({
    agencyId: viewer.agencyId,
    user: viewer.scope.user,
    gotPermIds: viewer.scope.gotPermIds,
    leadIds: waitingLeadIds,
  })
  const items = hydrateBriefWaitingItems(classified, waiters, nowMs, locale)
  const { remaining, handledToday, done } = progress({ qualifyingIds: items.map((i) => i.id), touchedTodayIds })
  const { statusVerdict, permissionVerdict } = completenessVerdict({ remaining, dataFresh: freshness.dataFresh })

  return {
    greeting: greetingFor(nowMs, BUSINESS_TZ, locale),
    firstName: viewer.firstName,
    dateLabel: formatBusinessLongDate(nowMs, BUSINESS_TZ, locale),
    items,
    total: items.length,
    remaining,
    handledToday,
    done,
    volumeState: volumeStateFor(remaining),
    statusVerdict,
    permissionVerdict,
    meetings: meetingsRaw.map((m) => toMeetingItem(m, locale)),
  }
}
