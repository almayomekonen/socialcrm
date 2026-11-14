import { db } from '@/config/db'
import { isAiUsageLedgerEnabled } from '@/lib/flags/aiUsageLedgerFlags'

/**
 * An agency's AI spend today (UTC day), read from the durable usage ledger.
 *
 * The in-memory guard (lib/ai/router/spend.ts) is per server instance and resets
 * on every cold start, so on serverless it bounds nothing across instances. This
 * reads what every instance has already WRITTEN — ai_usage_events, indexed on
 * ("agencyId", "createdAt") — so the AI_DAILY_USD_CAP holds across instances and
 * restarts. The admission gate takes the larger of the two figures.
 *
 * Limits of the figure, stated rather than hidden:
 *   - ledger rows are written just after each call, so a burst of parallel calls
 *     can overshoot the cap by the calls already in flight (the in-memory guard
 *     still bounds each instance meanwhile);
 *   - rows with an unknown cost add 0.
 *
 * null means "no durable figure": the ledger is off (AI_USAGE_LEDGER unset) or the
 * read failed. The gate then falls back to the in-memory guard alone — a database
 * blip must never stop AI for every customer, and is logged.
 */
export async function durableDailySpendUsd(agencyId: number, now: Date = new Date()): Promise<number | null> {
  if (!isAiUsageLedgerEnabled()) return null
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  try {
    const row = (await db('ai_usage_events')
      .where({ agencyId })
      .where('createdAt', '>=', dayStart)
      .sum({ usd: 'costUsd' })
      .first()
      .timeout(2_000, { cancel: true })) as { usd: string | number | null } | undefined
    const usd = Number(row?.usd ?? 0)
    return Number.isFinite(usd) ? usd : 0
  } catch (err) {
    console.error('[ai:spend] durable daily spend unavailable; in-memory guard only', { agencyId, code: (err as { code?: string })?.code ?? null })
    return null
  }
}
