import { cache } from 'react'
import { COPILOT_MODES } from '@/lib/ai/copilotModes'
import { resolvePlanAndSource } from './source'
import { getMonthlyAiUsage } from './aiUsage'
import { getMonthlyLimit, isModeAvailableOnPlan } from './limits'
import type { AiAccess, AiModeId, AiModeQuota, Entitlements, Plan } from './types'

/**
 * `getEntitlements(agencyId)` — the canonical read.
 *
 * Aggregation:
 *   plan + planSource  ← lib/entitlements/source       (agencies.plan + allowlist)
 *   monthly AI usage   ← lib/entitlements/aiUsage      (ai_runs aggregate)
 *   per-mode quota     ← lib/entitlements/limits       (FREE/PRO matrix)
 *
 * Two layers of caching, by design:
 *
 *   1. Request-scoped: `React.cache()` dedupes calls inside one request.
 *      A single RSC tree can call `getEntitlements()` from a layout, a page,
 *      and a server action without paying the cost three times.
 *
 *   2. Cross-request: `unstable_cache` inside `getMonthlyAiUsage` (60s TTL,
 *      tag = `ai-usage:agency:<id>`). The plan read is a small indexed
 *      single-row query; caching that across requests is more risk than
 *      benefit (a freshly-upgraded user must see Pro instantly), so we
 *      deliberately do not wrap it.
 *
 * The function is read-only. It MUST NOT write. It MUST NOT have side
 * effects on the agency record, on ai_runs, or on revalidation tags. Phase A
 * landing this with zero callers is intentional.
 */

async function computeEntitlements(agencyId: number): Promise<Entitlements> {
  const [{ plan, planSource }, usage] = await Promise.all([
    resolvePlanAndSource(agencyId),
    getMonthlyAiUsage(agencyId),
  ])

  const modes = buildModeAccess(plan, usage.byMode)

  const ai: AiAccess = {
    modes,
    totalUsedThisMonth: usage.total,
    windowStart: usage.windowStart,
  }

  return { agencyId, plan, planSource, ai }
}

function buildModeAccess(
  plan: Plan,
  byMode: Record<AiModeId, number>,
): AiAccess['modes'] {
  const result = {} as AiAccess['modes']
  for (const mode of COPILOT_MODES) {
    const limit = getMonthlyLimit(plan, mode.id)
    const used = byMode[mode.id] ?? 0
    const quota: AiModeQuota = {
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
    }
    result[mode.id] = {
      allowed: isModeAvailableOnPlan(plan, mode.id),
      quota,
    }
  }
  return result
}

/**
 * Request-scoped wrapper. `cache()` is from React, not from Next — it lives
 * for the duration of one request and is the right tool for "I want every
 * RSC and server action in this request to see the same snapshot."
 */
export const getEntitlements = cache(computeEntitlements)
