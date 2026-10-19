/**
 * SocialCRM AI over WhatsApp (pilot): rollout gate and operating limits.
 * ABSENCE BLOCKS.
 *
 * WA_ASSISTANT_AGENCY_IDS
 *   Explicit agency ids whose verified owner-reminder recipients may talk to the
 *   assistant on the platform number. Absent or empty means nobody; entries
 *   that are not plain digits (`all`, `*`, `true`) are ignored, so no value opens
 *   it to everyone. Pilot: `103`.
 *
 * WA_ASSISTANT_DAILY_USD_CAP
 *   Durable per-agency model spend per UTC day, summed from wa_assistant_jobs.
 *   Default 2 USD; non-numeric or non-positive values fall back to the default.
 *
 * The assistant also needs everything the reminders already need (the platform
 * number and token) and the Agent itself to be enabled for the agency
 * (`isAgentEnabled`, lib/ai/flags.ts). Read per call, never cached.
 */

export function waAssistantAgencyIds(): number[] {
  const ids = (process.env.WA_ASSISTANT_AGENCY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return [...new Set(ids)]
}

export function isWaAssistantAgency(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  return waAssistantAgencyIds().includes(agencyId)
}

const DEFAULT_DAILY_USD_CAP = 2

export function waAssistantDailyUsdCap(): number {
  const n = Number(process.env.WA_ASSISTANT_DAILY_USD_CAP)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_USD_CAP
}

/** Operating limits. Deliberately constants: changing one is a reviewed code change. */
export const WA_ASSISTANT_LIMITS = {
  /** Messages one recipient may send per rolling hour. */
  perSenderPerHour: 20,
  /** Messages one agency may send per UTC day, across all its recipients. */
  perAgencyPerDay: 200,
  /** Prior turns forwarded to the Agent (three exchanges), and how long they live. */
  historyTurns: 6,
  historyMs: 24 * 60 * 60 * 1000,
  /** A reply must leave before Meta's 24-hour service window closes; keep a margin. */
  replyWindowMs: 23 * 60 * 60 * 1000,
  /** One Agent turn: fewer steps and a shorter clock than the web Agent. */
  maxSteps: 5,
  deadlineMs: 35_000,
  /** A `running` job older than this was interrupted: it is failed, never re-run. */
  leaseMs: 3 * 60 * 1000,
  /** Question length kept and forwarded. */
  maxQuestionChars: 1000,
  /** Jobs one worker pass handles. */
  batch: 5,
} as const
