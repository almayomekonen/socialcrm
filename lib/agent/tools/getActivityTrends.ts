import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getActivityWindow, type ActivityWindow } from '@/db/agentBusiness'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * BI tool — is the business getting busier or quieter.
 *
 * TWO WINDOWS, NOT ONE. A single period is a number; a trend needs a
 * predecessor, so this reads the last `days` and the `days` before that and
 * reports both. The comparison is the point — "14 new leads" says nothing until
 * you know last fortnight was 30.
 *
 * IT REPORTS COUNTS AND REFUSES TO REPORT A VERDICT. There is no `trend: 'down'`
 * field, deliberately. Whether a change is meaningful depends on how small the
 * numbers are, and a tool that stamped "declining" on 3 leads versus 5 would be
 * manufacturing a business conclusion out of noise — the exact fabrication the
 * evidence gate exists to stop. Instead it ships `sampleSize` and
 * `comparisonReliable`, and the model has to reason, hedge, and say when the
 * numbers are too small to support a claim.
 *
 * `comparisonReliable` is a stated, checkable rule rather than a judgement: both
 * windows must clear a floor. Below it the honest answer is "too little activity
 * to compare", which is a useful answer and not a failure.
 *
 * EVERY DIMENSION IS A COUNT OF REAL ROWS — leads created, status transitions,
 * inbound and outbound messages, and days on which any of those happened.
 * Nothing is derived, averaged or projected. There is no revenue and no
 * conversion rate here because the schema cannot support either.
 */

export const ACTIVITY_METRIC_IDS = [
  'activity.new_leads',
  'activity.status_changes',
  'activity.inbound_messages',
  'activity.outbound_messages',
  'activity.active_days',
] as const

/** Default comparison: the last two weeks against the two before them. */
const DEFAULT_DAYS = 14

/**
 * The floor for a comparison to mean anything.
 *
 * Below this, a difference is as likely to be a quiet fortnight as a trend. The
 * number is a stated convention, not a statistical test — the honest claim it
 * supports is "too small to compare", never a confidence level.
 */
const MIN_EVENTS_FOR_COMPARISON = 5

function totalEvents(w: ActivityWindow): number {
  return w.newLeads + w.statusChanges + w.inboundMessages + w.outboundMessages
}

export function makeGetActivityTrends(deps: {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  nowMs: number
}) {
  return tool({
    description:
      'Whether the business is becoming more or less active: new leads, status changes, inbound and outbound messages and active days, for a recent period AND the period before it. Use it for "how has my activity looked lately", "is the business slowing down", "what changed". It returns counts and a reliability flag, never a verdict — decide the direction yourself from the two windows, and say plainly when the numbers are too small to compare.',
    inputSchema: z.object({
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(`Length of each window in days. Defaults to ${DEFAULT_DAYS}; the previous window of equal length is always returned alongside.`),
    }),
    execute: async ({ days }) => {
      const window = Math.min(Math.max(Math.trunc(days ?? DEFAULT_DAYS), 1), 90)
      const verdict = deps.budget.canStep('get_activity_trends', String(window))
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const s = readerScope(deps.scope)
      const [current, previous] = await Promise.all([
        getActivityWindow(s, { days: window }),
        getActivityWindow(s, { days: window, endingDaysAgo: window }),
      ])

      const asOf = new Date(deps.nowMs).toISOString()
      const from = new Date(deps.nowMs - window * 86_400_000).toISOString()
      const ref = { from, to: asOf }

      // The metric records the CURRENT window and carries its own sample size,
      // so an OBSERVATION citing it cannot quietly drop the n that makes it
      // honest.
      const metrics: Record<string, number> = {
        'activity.new_leads': current.newLeads,
        'activity.status_changes': current.statusChanges,
        'activity.inbound_messages': current.inboundMessages,
        'activity.outbound_messages': current.outboundMessages,
        'activity.active_days': current.activeDays,
      }
      for (const [metric, n] of Object.entries(metrics)) deps.evidence.add({ kind: 'metric', metric, window: ref, n })

      const currentEvents = totalEvents(current)
      const previousEvents = totalEvents(previous)
      const comparisonReliable = currentEvents >= MIN_EVENTS_FOR_COMPARISON && previousEvents >= MIN_EVENTS_FOR_COMPARISON

      const payload = {
        windowDays: window,
        current,
        previous,
        metrics,
        sampleSize: { current: currentEvents, previous: previousEvents },
        /** False when either window is too thin for a difference to mean anything. */
        comparisonReliable,
        comparisonNote: comparisonReliable
          ? 'Both windows carry enough activity to compare. State the direction and the numbers behind it.'
          : `Too little activity to compare reliably (fewer than ${MIN_EVENTS_FOR_COMPARISON} events in a window). Say so plainly instead of calling it growth or decline.`,
        // No revenue and no conversion rate: the schema supports neither, and a
        // trend tool is exactly where an invented one would look plausible.
        unavailable: ['revenue', 'conversion_rate'],
        asOf,
      }

      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
