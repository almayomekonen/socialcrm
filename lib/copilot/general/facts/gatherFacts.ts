import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  getUnreadInboxSummary,
  type BriefingLeadList,
  type Scope,
} from '@/db/briefing'
import type { FactGroup, FactRow, FactSource, FactsBundle } from './types'

function listToGroup(source: FactSource, list: BriefingLeadList): FactGroup {
  return {
    source,
    total: list.total,
    rows: list.sample.map(
      (r): FactRow => ({
        refId: String(r.id),
        name: r.name ?? 'ליד ללא שם',
        status: r.status ?? null,
        ageDays: r.ageDays ?? null,
        waitingDays: r.waitingDays ?? null,
        freshnessDays: r.freshnessDays ?? null,
        source,
      }),
    ),
  }
}

async function safeList(fn: () => Promise<BriefingLeadList>): Promise<BriefingLeadList> {
  try {
    return await fn()
  } catch {
    return { total: 0, sample: [] }
  }
}

async function safeInbox(
  fn: () => Promise<{ conversations: number; unread: number }>,
): Promise<{ conversations: number; unread: number }> {
  try {
    return await fn()
  } catch {
    return { conversations: 0, unread: 0 }
  }
}

export async function gatherTriageFacts(scope: Scope): Promise<FactsBundle> {
  const [overdue, dueToday, stale, fresh, promised, inbox] = await Promise.all([
    safeList(() => getOverdueTaskSummary(scope)),
    safeList(() => getFollowUpsDueToday(scope)),
    safeList(() => getLeadsNotContactedRecently(scope)),
    safeList(() => getNewLeadsThisWeek(scope)),
    safeList(() => getPromisedButWaiting(scope)),
    safeInbox(() => getUnreadInboxSummary(scope)),
  ])

  return {
    groups: [
      listToGroup('tasks.overdue', overdue),
      listToGroup('followups.dueToday', dueToday),
      listToGroup('leads.notContactedRecently', stale),
      listToGroup('leads.newThisWeek', fresh),
      listToGroup('followups.promisedWaiting', promised),
      {
        source: 'inbox.unread',
        total: inbox.unread,
        rows: [],
        meta: { conversations: inbox.conversations, unread: inbox.unread },
      },
    ],
  }
}
