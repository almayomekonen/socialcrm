import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getFollowUpsDueToday, getOverdueTaskSummary, getPromisedButWaiting } from '@/db/briefing'
import { getLeadsWithoutNextStep, getOverdueFollowUps } from '@/db/agentBusiness'
import { readerScope } from './readerScope'
import { entityRef } from '../evidence'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * BI tool — the follow-up loop, and where it is leaking.
 *
 * It answers one question precisely: "על מי אני צריך לחזור?" The four states it
 * reports are genuinely different failures, and collapsing them would lose the
 * distinction the rep needs to act:
 *
 *   due_today        the loop is working — do these now
 *   overdue          the loop was set and missed
 *   no_next_step     the loop was never closed; nothing will surface this lead
 *   awaiting_reply   the customer answered and the business has not
 *
 * FOLLOW-UP STATE IS READ, NEVER INFERRED. Every count comes from a real column
 * or a real row — `nextFollowUpAt`, an open `tasks` row, an inbound message
 * later than the last outbound. Nothing here guesses that a lead "probably needs"
 * a follow-up from partial evidence; a lead with no follow-up is reported as
 * having none, which is a fact, rather than as being overdue, which would not be.
 *
 * Overlaps `get_lead_health` deliberately, and does less. That one describes the
 * whole book for "who needs attention"; this one is the focused call for a
 * follow-up question, so a rep asking only about callbacks does not pay for cold
 * leads and new arrivals they did not ask about.
 */

export const FOLLOW_UP_METRIC_IDS = [
  'followup.due_today',
  'followup.overdue',
  'followup.no_next_step',
  'followup.awaiting_reply',
  'followup.overdue_tasks',
] as const

const SAMPLE_PER_CATEGORY = 5

export function makeGetFollowUpHealth(deps: {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  nowMs: number
}) {
  return tool({
    description:
      'Who the rep owes a callback to, and where the follow-up loop is leaking: follow-ups due today, follow-ups already overdue, open leads with NO next step at all, leads whose customer replied and is still waiting, and leads carrying an overdue task. Use this for "who should I follow up with", "who do I need to call back", "did I forget anyone". Narrower and cheaper than get_lead_health — prefer it when the question is specifically about follow-up. Takes no arguments.',
    inputSchema: z.object({}),
    execute: async () => {
      const verdict = deps.budget.canStep('get_follow_up_health', '')
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const s = readerScope(deps.scope)
      const [dueToday, overdue, noNextStep, awaiting, overdueTasks] = await Promise.all([
        getFollowUpsDueToday(s),
        getOverdueFollowUps(s),
        getLeadsWithoutNextStep(s),
        getPromisedButWaiting(s),
        getOverdueTaskSummary(s),
      ])

      const asOf = new Date(deps.nowMs).toISOString()
      const window = { from: asOf, to: asOf }

      const groups = [
        ['due_today', 'followup.due_today', dueToday, 'a follow-up is scheduled for today'],
        ['overdue', 'followup.overdue', overdue, 'the follow-up date has already passed'],
        ['no_next_step', 'followup.no_next_step', noNextStep, 'open, with no follow-up date and no open task'],
        ['awaiting_reply', 'followup.awaiting_reply', awaiting, 'the customer wrote last and is still waiting'],
        ['overdue_tasks', 'followup.overdue_tasks', overdueTasks, 'a task on this lead is past its due date'],
      ] as const

      const metrics: Record<string, number> = {}
      const out: Record<string, unknown> = {}

      for (const [id, metric, list, reason] of groups) {
        metrics[metric] = list.total
        deps.evidence.add({ kind: 'metric', metric, window, n: list.total })
        const sample = list.sample.slice(0, SAMPLE_PER_CATEGORY)
        for (const row of sample) deps.evidence.add({ kind: 'lead', refId: String(row.id) })
        out[id] = {
          total: list.total,
          reason,
          truncated: list.total > sample.length,
          leads: sample.map((r) => ({
            leadId: r.id,
            evidenceRef: entityRef('lead', r.id),
            name: r.name,
            status: r.status,
            waitingDays: r.waitingDays ?? null,
            ageDays: r.ageDays ?? null,
          })),
        }
      }

      const payload = { metrics, categories: out, asOf }
      deps.budget.noteResult(JSON.stringify(payload).slice(0, 2000))
      return payload
    },
  })
}
