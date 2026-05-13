import { unstable_cache } from 'next/cache'
import { db } from '@/config/db'
import type { AiModeId } from './types'

/**
 * Monthly AI usage aggregation.
 *
 * Source: `ai_runs`. Filters:
 *   - `agencyId = $1`
 *   - `success = true` — failed runs don't decrement quota. This mirrors the
 *     pricing-page contract ("10 AI actions per month") and how reps would
 *     reasonably interpret a quota: a provider 500 should not cost them a
 *     turn.
 *   - `startedAt >= date_trunc('month', now() AT TIME ZONE 'UTC')` — the
 *     window is a UTC calendar month. We pick UTC over Asia/Jerusalem because
 *     row timestamps are stored in UTC and we want the boundary to be
 *     deterministic across DST transitions.
 *
 * Output shape: one row per `mode` with a count. Modes the user has not
 * exercised this month simply don't appear; the aggregator fills zeros.
 *
 * Caching:
 *   - `unstable_cache` with a 60s TTL keyed by agencyId. The cost of being
 *     up to 60s stale on a usage counter is negligible; the cost of a DB
 *     round-trip on every Copilot request is not. Tag the entry so the
 *     persistence layer can call `revalidateTag` when it writes a new run.
 *     Phase A only *reads* — the matching `revalidateTag` call is scoped
 *     to a later phase, but the tag is defined here so call sites already
 *     point at the right name.
 */

export type AiUsageRow = { mode: AiModeId | null; count: number }
export type AiMonthlyUsage = {
  byMode: Record<AiModeId, number>
  total: number
  /** ISO start-of-month (UTC) the counters describe. */
  windowStart: string
}

export const aiUsageTag = (agencyId: number) => `ai-usage:agency:${agencyId}`

function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
}

function emptyByMode(): Record<AiModeId, number> {
  return { fast: 0, smart: 0, advanced: 0 }
}

function asAiModeId(raw: unknown): AiModeId | null {
  return raw === 'fast' || raw === 'smart' || raw === 'advanced' ? raw : null
}

async function readMonthlyUsage(agencyId: number): Promise<AiMonthlyUsage> {
  const windowStart = startOfMonthUtc()
  const rows = await db('ai_runs')
    .where({ agencyId, success: true })
    .andWhere('startedAt', '>=', windowStart)
    .groupBy('mode')
    .select<Array<{ mode: string | null; count: string }>>('mode')
    .count('id as count')

  const byMode = emptyByMode()
  let total = 0
  for (const row of rows) {
    const n = Number(row.count) || 0
    total += n
    const mode = asAiModeId(row.mode)
    if (mode) byMode[mode] = n
  }

  return { byMode, total, windowStart: windowStart.toISOString() }
}

/**
 * Cached wrapper. Cross-request: 60s TTL + tag-based invalidation. The tag
 * is exported above so future write paths can revalidate it.
 *
 * Note: `unstable_cache` keys must be JSON-serializable primitives — that's
 * why agencyId is stringified.
 */
export async function getMonthlyAiUsage(agencyId: number): Promise<AiMonthlyUsage> {
  const cached = unstable_cache(
    async (id: number) => readMonthlyUsage(id),
    ['entitlements', 'ai-usage', String(agencyId)],
    { revalidate: 60, tags: [aiUsageTag(agencyId)] },
  )
  return cached(agencyId)
}
