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
 * WA_ASSISTANT_AUDIENCE
 *   Exactly `all`: every agency is in the audience (WA_ASSISTANT_AGENCY_IDS is
 *   then ignored). Anything else, or absent: the explicit list above, as before.
 *   Being in the audience only makes an agency eligible: every turn still needs
 *   product access, an active verified recipient, the assistant consent, an
 *   active user and Agent availability (lib/waAssistant/identity.ts).
 *
 * WA_ASSISTANT_EXCLUDED_AGENCY_IDS
 *   Explicit ids that never get the assistant, in either mode. Plain digits only.
 *
 * WA_ASSISTANT_DAILY_USD_CAP
 *   Durable per-agency model spend per UTC day, summed from wa_assistant_jobs.
 *   Default 2 USD; non-numeric or non-positive values fall back to the default.
 *
 * The assistant also needs everything the reminders already need (the platform
 * number and token) and the Agent itself to be available for the agency
 * (`isAgentAvailable`, lib/ai/agentAvailability.ts). Read per call, never cached.
 */

function parseIds(raw: string | undefined): number[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return [...new Set(ids)]
}

export function waAssistantAgencyIds(): number[] {
  return parseIds(process.env.WA_ASSISTANT_AGENCY_IDS)
}

export function waAssistantExcludedAgencyIds(): number[] {
  return parseIds(process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS)
}

export type WaAssistantAudience =
  | { mode: 'all'; excludedIds: number[] }
  | { mode: 'list'; agencyIds: number[]; excludedIds: number[] }

export function waAssistantAudience(): WaAssistantAudience {
  const excludedIds = waAssistantExcludedAgencyIds()
  if (process.env.WA_ASSISTANT_AUDIENCE?.trim() === 'all') return { mode: 'all', excludedIds }
  return { mode: 'list', agencyIds: waAssistantAgencyIds().filter((id) => !excludedIds.includes(id)), excludedIds }
}

/** True when at least one agency can be in the audience (so inbound work is worth doing at all). */
export function hasWaAssistantAudience(audience: WaAssistantAudience = waAssistantAudience()): boolean {
  return audience.mode === 'all' || audience.agencyIds.length > 0
}

export function isWaAssistantAgency(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  const audience = waAssistantAudience()
  if (audience.excludedIds.includes(agencyId)) return false
  return audience.mode === 'all' || audience.agencyIds.includes(agencyId)
}

/**
 * WA_ASSISTANT_MEETINGS_AGENCY_IDS: agencies whose assistant may CREATE meetings
 * (confirmation card → existing Action Runtime). ABSENCE BLOCKS, explicit ids
 * only, and only for an agency that also has the assistant itself. Off, the
 * assistant stays read-only exactly as before.
 */
export function isWaAssistantMeetingsAgency(agencyId: number | null | undefined): boolean {
  if (!isWaAssistantAgency(agencyId)) return false
  const ids = (process.env.WA_ASSISTANT_MEETINGS_AGENCY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
  return ids.includes(agencyId as number)
}

/**
 * WA_ASSISTANT_SENDER_GUIDANCE=1: a sender the assistant cannot answer gets ONE
 * fixed reply per 24 hours saying how to connect, instead of silence
 * (lib/whatsapp/platform/senderGuidance.ts). Exactly `1`; absent = off, as before.
 */
export function isWaAssistantSenderGuidanceEnabled(): boolean {
  return process.env.WA_ASSISTANT_SENDER_GUIDANCE === '1'
}

/**
 * WA_ASSISTANT_TASKS_AGENCY_IDS: agencies whose assistant may create TASKS and
 * FOLLOW-UPS (confirmation card → existing Action Runtime executors). ABSENCE
 * BLOCKS, explicit ids only, and only for an agency that also has the assistant
 * itself (so an exclusion or a lost audience still wins).
 */
export function isWaAssistantTasksAgency(agencyId: number | null | undefined): boolean {
  if (!isWaAssistantAgency(agencyId)) return false
  return parseIds(process.env.WA_ASSISTANT_TASKS_AGENCY_IDS).includes(agencyId as number)
}

/**
 * WA_ASSISTANT_STATUS_AGENCY_IDS: agencies whose assistant may CHANGE A LEAD'S
 * STATUS (card → `update_lead_status`). Its own switch because a status change
 * can fire the business's automations. Same rules as the tasks switch:
 * absence blocks, explicit ids only, and only on top of the assistant itself.
 */
export function isWaAssistantStatusAgency(agencyId: number | null | undefined): boolean {
  if (!isWaAssistantAgency(agencyId)) return false
  return parseIds(process.env.WA_ASSISTANT_STATUS_AGENCY_IDS).includes(agencyId as number)
}

/** WA_ASSISTANT_NOTES_AGENCY_IDS: may ADD A NOTE to a lead (card → `add_lead_note`). Same rules. */
export function isWaAssistantNotesAgency(agencyId: number | null | undefined): boolean {
  if (!isWaAssistantAgency(agencyId)) return false
  return parseIds(process.env.WA_ASSISTANT_NOTES_AGENCY_IDS).includes(agencyId as number)
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
  /**
   * Jobs one worker pass claims. ONE: a job can take ~46s (typing 3s + Agent
   * 35s + send 8s) and both entry points stop at 60s, so a second claimed job
   * would be killed mid-run and reaped later without a reply. Unclaimed jobs
   * stay queued for the next kick or cron tick.
   */
  batch: 1,
} as const
