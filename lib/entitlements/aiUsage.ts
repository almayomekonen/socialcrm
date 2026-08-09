import { unstable_cache } from 'next/cache'
import { db } from '@/config/db'
import type { AiModeId } from './types'

export type AiUsageRow = { mode: AiModeId | null; count: number }
export type AiMonthlyUsage = {
  byMode: Record<AiModeId, number>
  total: number
  /** ISO start-of-month (UTC) the counters describe. */
  windowStart: string
}

export const aiUsageTag = (agencyId: number) => `ai-usage:agency:${agencyId}`

/**
 * The monthly window every usage counter shares. Exported so sibling counters
 * (lib/quota/planUsage) report the same period as the AI numbers they are
 * displayed beside — two "this month" figures computed off two different
 * boundaries would silently disagree at the start of each month.
 */
export function startOfMonthUtc(now: Date = new Date()): Date {
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
  const cached = unstable_cache(async (id: number) => readMonthlyUsage(id), ['entitlements', 'ai-usage', String(agencyId)], {
    revalidate: 60,
    tags: [aiUsageTag(agencyId)],
  })
  return cached(agencyId)
}
