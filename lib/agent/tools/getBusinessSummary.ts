import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  getUnreadInboxSummary,
} from '@/db/briefing'
import { getLeadTotals } from '@/db/agentBusiness'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 6 — the shape of the business, in counts.
 *
 * WHAT IT IS FOR. "מה קרה בעסק היום", "מה פספסתי השבוע", "מה המצב" — questions
 * about the whole book rather than one queue or one person. Without it the model
 * had to call several segment tools to answer a single orientation question and
 * spent most of a six-step budget doing it.
 *
 * COUNTS ONLY, NO NAMES, and that is the point. It is the cheap first call that
 * tells the Agent WHERE to look; `get_lead_segment` and `get_lead` are how it
 * then looks. Returning samples here would duplicate those tools and tempt the
 * model to answer about individuals from a summary that was never meant to
 * identify them — so nothing citable as a lead is emitted, only metrics.
 *
 * Consequently every claim built on this tool alone can only be an OBSERVATION:
 * the collector receives metric refs and no entity refs, so a FACT about a named
 * person cannot be grounded in it. The validator enforces that, not this comment.
 *
 * ONE ROUND TRIP, six existing readers in parallel. Each is the same query the
 * Today briefing already runs, so these numbers cannot drift from what the rep
 * sees elsewhere in the product. Authorization and the agency are inherited from
 * `readerScope(deps.scope)` exactly as in every other tool; the model supplies
 * nothing at all — the input schema is empty.
 */

export const BUSINESS_SUMMARY_METRIC_IDS = [
  'business.total_leads',
  'business.open_leads',
  'business.followups_due_today',
  'business.not_contacted_recently',
  'business.new_this_week',
  'business.overdue_tasks',
  'business.waiting_for_reply',
  'business.unread_conversations',
  'business.unread_messages',
] as const

export function makeGetBusinessSummary(deps: {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  nowMs: number
}) {
  return tool({
    description:
      'A count-only overview of the whole book: how many leads there are in total and how many are still open, how many have follow-ups due today, how many have gone cold, how many arrived this week, how many carry an overdue task, how many are waiting on a reply, and how much of the inbox is unread. Call this to orient yourself on broad questions — "what is going on in the business", "what did I miss this week" — then use get_lead_segment or get_today_state to see the actual leads. Returns no names and no ids. Takes no arguments.',
    inputSchema: z.object({}),
    execute: async () => {
      const verdict = deps.budget.canStep('get_business_summary', '')
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const s = readerScope(deps.scope)
      const [totals, followUps, cold, fresh, overdue, waiting, inbox] = await Promise.all([
        getLeadTotals(s),
        getFollowUpsDueToday(s),
        getLeadsNotContactedRecently(s),
        getNewLeadsThisWeek(s),
        getOverdueTaskSummary(s),
        getPromisedButWaiting(s),
        getUnreadInboxSummary(s),
      ])

      const metrics: Record<string, number> = {
        // The size of the book. Added because the first live evaluation could not
        // answer "כמה לידים יש לי?" — every other reader counts a SEGMENT, and
        // none counted the whole, so the honest answer was "unavailable" for a
        // number the database plainly holds.
        'business.total_leads': totals.all,
        'business.open_leads': totals.open,
        'business.followups_due_today': followUps.total,
        'business.not_contacted_recently': cold.total,
        'business.new_this_week': fresh.total,
        'business.overdue_tasks': overdue.total,
        'business.waiting_for_reply': waiting.total,
        'business.unread_conversations': inbox.conversations,
        'business.unread_messages': inbox.unread,
      }

      const asOf = new Date(deps.nowMs).toISOString()
      const window = { from: asOf, to: asOf }
      // Metrics only. No `kind: 'lead'` ref is added anywhere in this tool, which
      // is what keeps a summary from grounding a claim about a named person.
      for (const [metric, n] of Object.entries(metrics)) deps.evidence.add({ kind: 'metric', metric, window, n })

      const payload = { metrics, asOf }
      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
