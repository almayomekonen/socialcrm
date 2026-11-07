import 'server-only'
import { founderAbuseCounts, waAssistantUsage, type WaAssistantJob } from '@/db/waAssistantJobs'
import { founderEntitlement } from '@/db/platformEntitlements'
import { FOUNDER_ABUSE_GUARDS, WA_ASSISTANT_LIMITS, waAssistantDailyUsdCap } from '@/lib/flags/waAssistantFlags'

/**
 * The assistant's usage limits for one job, after identity has passed.
 *
 * COMMERCIAL limits (everyone except a verified founder):
 *   sender_limit  20 per sender per rolling hour
 *   agency_limit  200 per agency per UTC day
 *   spend_limit   the agency's assistant spend today ≥ the daily USD cap
 *
 * FOUNDER (platform_entitlements `founder_unlimited_usage`, this agency AND
 * user): the commercial limits are waived and recorded in `waived`. In their
 * place, TECHNICAL abuse protection that only stops abnormal traffic:
 *   abuse_burst   > 10 messages in a rolling minute
 *   abuse_hourly  > 120 messages in a rolling hour
 *   abuse_loop    the 5th consecutive identical text within 10 minutes
 *
 * `firstOver`: only the FIRST message over a limit is answered, so a limit can
 * never itself become a flood of replies.
 */

export type LimitRefusal = { reason: 'sender_limit' | 'agency_limit' | 'spend_limit' | 'abuse_burst' | 'abuse_hourly' | 'abuse_loop'; firstOver: boolean }
export type LimitDecision = { refusal: LimitRefusal | null; founder: boolean; waived: Array<'sender_limit' | 'agency_limit' | 'spend_limit'> }

export async function decideUsageLimits(job: WaAssistantJob, now: Date): Promise<LimitDecision> {
  const usage = await waAssistantUsage(job, now)
  const commercial: LimitRefusal | null =
    usage.senderLastHour >= WA_ASSISTANT_LIMITS.perSenderPerHour ? { reason: 'sender_limit', firstOver: usage.senderLastHour === WA_ASSISTANT_LIMITS.perSenderPerHour }
    : usage.agencyToday >= WA_ASSISTANT_LIMITS.perAgencyPerDay ? { reason: 'agency_limit', firstOver: usage.agencyToday === WA_ASSISTANT_LIMITS.perAgencyPerDay }
    : usage.agencySpendTodayUsd >= waAssistantDailyUsdCap() ? { reason: 'spend_limit', firstOver: true }
    : null

  const founder = await founderEntitlement(job.agencyId, job.userId)
  if (!founder) return { refusal: commercial, founder: false, waived: [] }

  const waived: LimitDecision['waived'] = []
  if (usage.senderLastHour >= WA_ASSISTANT_LIMITS.perSenderPerHour) waived.push('sender_limit')
  if (usage.agencyToday >= WA_ASSISTANT_LIMITS.perAgencyPerDay) waived.push('agency_limit')
  if (usage.agencySpendTodayUsd >= waAssistantDailyUsdCap()) waived.push('spend_limit')

  const abuse = await founderAbuseCounts(job, now)
  const g = FOUNDER_ABUSE_GUARDS
  const refusal: LimitRefusal | null =
    abuse.lastMinute >= g.perMinute ? { reason: 'abuse_burst', firstOver: abuse.lastMinute === g.perMinute }
    : abuse.lastHour >= g.perHour ? { reason: 'abuse_hourly', firstOver: abuse.lastHour === g.perHour }
    : abuse.identicalRun >= g.identicalRun ? { reason: 'abuse_loop', firstOver: abuse.identicalRun === g.identicalRun }
    : null
  return { refusal, founder: true, waived }
}
