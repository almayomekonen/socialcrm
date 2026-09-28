import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getPromisedButWaiting,
  type BriefingLeadList,
} from '@/db/briefing'
import { getLeadsWithoutNextStep, getOverdueFollowUps } from '@/db/agentBusiness'
import { readerScope } from './readerScope'
import { entityRef } from '../evidence'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * BI tool — which leads deserve attention, and why.
 *
 * ONE CALL, EVERY CATEGORY, because the question it answers ("מי צריך טיפול",
 * "יש לידים שהוזנחו") is about the SHAPE of the book, not one slice of it. Six
 * separate segment calls would exhaust a six-step budget before the model could
 * reason about what it found.
 *
 * THERE IS NO LEAD SCORE, AND THIS TOOL SAYS SO. SocialCRM has no scoring or
 * heat model, so the payload carries `hasLeadScore: false` and no ranking
 * number. Categories are named STATES with a stated reason, and any ordering the
 * model applies has to be argued from those states rather than presented as a
 * product metric the rep could go and look up. Inventing a score here would be
 * the most convincing lie the agent could tell.
 *
 * EVERY CATEGORY IS AN EXISTING READER. Four come from the Today briefing
 * unchanged, so the Agent cannot disagree with the rest of the product about who
 * is overdue; two are new because nothing could answer them before — a follow-up
 * whose date has already passed, and an open lead with no next step at all.
 *
 * Authorization is inherited from `readerScope(deps.scope)`; the model supplies
 * nothing at all, so there is no filter through which it could widen the set.
 */

export const LEAD_HEALTH_METRIC_IDS = [
  'health.waiting_for_reply',
  'health.follow_up_due_today',
  'health.follow_up_overdue',
  'health.no_next_step',
  'health.gone_cold',
  'health.new_this_week',
] as const

/** How many leads of each category reach the model. Totals are always exact. */
const SAMPLE_PER_CATEGORY = 5

type CategoryDef = { metric: string; reason: string; read: (s: never) => Promise<BriefingLeadList> }

export function makeGetLeadHealth(deps: {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  nowMs: number
}) {
  return tool({
    description:
      'The health of the lead book, in one call: which leads are waiting on a reply, which have a follow-up due today, which have a follow-up already overdue, which have NO next step at all, which have gone cold, and which arrived this week. Returns the true total per category plus a few citable leads from each. Use it for "who needs attention", "am I missing leads", "which leads matter most" — and ALWAYS for a broad judgement question (biggest problem, what to focus on, what is being missed), including when get_today_state already returned items, because the daily queue does not show stale leads or leads with no next step. There is no lead score in SocialCRM and this tool returns none — rank by the states it reports and say why. Takes no arguments.',
    inputSchema: z.object({}),
    execute: async () => {
      const verdict = deps.budget.canStep('get_lead_health', '')
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const s = readerScope(deps.scope)
      const categories: Record<string, CategoryDef> = {
        waiting_for_reply: {
          metric: 'health.waiting_for_reply',
          reason: 'the customer wrote last and is still waiting on the business',
          read: (x) => getPromisedButWaiting(x),
        },
        follow_up_due_today: {
          metric: 'health.follow_up_due_today',
          reason: 'a follow-up is scheduled for today',
          read: (x) => getFollowUpsDueToday(x),
        },
        follow_up_overdue: {
          metric: 'health.follow_up_overdue',
          reason: 'the scheduled follow-up date has already passed',
          read: (x) => getOverdueFollowUps(x as never),
        },
        no_next_step: {
          metric: 'health.no_next_step',
          reason: 'open, with no follow-up date and no open task — nothing will surface it again',
          read: (x) => getLeadsWithoutNextStep(x as never),
        },
        gone_cold: {
          metric: 'health.gone_cold',
          reason: 'no contact for longer than the CRM’s staleness window',
          read: (x) => getLeadsNotContactedRecently(x),
        },
        new_this_week: {
          metric: 'health.new_this_week',
          reason: 'arrived since the start of this week',
          read: (x) => getNewLeadsThisWeek(x),
        },
      }

      const entries = Object.entries(categories)
      const lists = await Promise.all(entries.map(([, def]) => def.read(s as never)))

      const asOf = new Date(deps.nowMs).toISOString()
      const window = { from: asOf, to: asOf }
      const metrics: Record<string, number> = {}
      const out: Record<string, unknown> = {}

      entries.forEach(([id, def], i) => {
        const list = lists[i]!
        metrics[def.metric] = list.total
        deps.evidence.add({ kind: 'metric', metric: def.metric, window, n: list.total })

        const sample = list.sample.slice(0, SAMPLE_PER_CATEGORY)
        for (const row of sample) deps.evidence.add({ kind: 'lead', refId: String(row.id) })

        out[id] = {
          total: list.total,
          /** Why a lead is in this category. The model must argue from this, not from a score. */
          reason: def.reason,
          truncated: list.total > sample.length,
          leads: sample.map((r) => ({
            leadId: r.id,
            evidenceRef: entityRef('lead', r.id),
            name: r.name,
            status: r.status,
            ageDays: r.ageDays ?? null,
            waitingDays: r.waitingDays ?? null,
          })),
        }
      })

      const payload = {
        /**
         * Stated in the payload, not only in the description: the model sees this
         * on every call, and a rep asking "מי הליד הכי חם" must be told the
         * product has no such measure rather than handed a number that looks like
         * one.
         */
        hasLeadScore: false,
        scoringNote:
          'SocialCRM has no lead score or heat model. Rank by the categories below and state the reason; never present an ordering as a product metric.',
        metrics,
        categories: out,
        asOf,
      }

      deps.budget.noteResult(JSON.stringify(payload).slice(0, 2000))
      return payload
    },
  })
}
