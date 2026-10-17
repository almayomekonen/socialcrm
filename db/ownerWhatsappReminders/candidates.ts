import type { Knex } from 'knex'
import { db } from '@/config/db'
import { humanOutboundSql } from '@/lib/inbox/humanReply'
import { REMINDER_COOLDOWN_MS, REMINDER_DELAY_MS, REMINDER_MAX_AGE_MS } from '@/lib/ownerWhatsappReminders/constants'
import type { ActiveRecipient } from '@/lib/ownerWhatsappReminders/selectRecipients'
import { ALWAYS_EXCLUDED_AGENCY_IDS, type OwnerWaAudience } from '@/lib/flags/ownerWhatsappReminderFlags'

/**
 * Which agencies a query may touch: an explicit id list, or the configured
 * audience (`all` = every agency). ALWAYS_EXCLUDED_AGENCY_IDS and the
 * audience's exclusions are applied in SQL in every case.
 */
export type AgencyScope = number[] | OwnerWaAudience

export function scopeBindings(scope: AgencyScope): { allAgencies: boolean; agencyIds: string; excludedAgencyIds: string } {
  const list = Array.isArray(scope) ? scope : scope.mode === 'list' ? scope.agencyIds : []
  const excluded = [...new Set([...ALWAYS_EXCLUDED_AGENCY_IDS, ...(Array.isArray(scope) ? [] : scope.excludedIds)])]
  return {
    allAgencies: !Array.isArray(scope) && scope.mode === 'all',
    agencyIds: `{${list.join(',')}}`,
    excludedAgencyIds: `{${excluded.join(',')}}`,
  }
}

export function isEmptyScope(scope: AgencyScope): boolean {
  return Array.isArray(scope) ? scope.length === 0 : scope.mode === 'list' && scope.agencyIds.length === 0
}

/**
 * Hand-offs that are due a reminder. Built from `findPendingHandoffsQuery`
 * (db/notifications/unanswered.ts), with these differences:
 *   - questionnaire hand-offs are INCLUDED;
 *   - only allowlisted agencies, only WhatsApp conversations;
 *   - the hand-off is 120 minutes to 24 hours old;
 *   - never a second reminder for the same escalation, never while another
 *     reminder for the conversation is still scheduled, and never within the
 *     12-hour cooldown of a delivery that was sent, sending or unknown.
 *
 * A conversation without a ליד is eligible on the conversation checks alone.
 * "Human reply" is `humanOutboundSql`: a reply from SocialCRM or from the
 * WhatsApp Business app; AI, automation, history and failed sends are not.
 */

/**
 * `escalatedAt` is for arithmetic (waiting time, recipient selection): a JS Date
 * keeps milliseconds only. `escalatedAtExact` is PostgreSQL's own text of the
 * timestamp, microseconds included, and is the ONLY value used to match or
 * store the escalation in SQL (`= :x::timestamptz`, the reminders unique key).
 * Round-tripping the Date instead never matches a real escalation.
 */
export type ReminderCandidate = {
  conversationId: number
  agencyId: number
  leadId: number | null
  handlerUserId: number | null
  customerWaId: string | null
  escalatedAt: Date
  escalatedAtExact: string
}

/** The eligibility conditions, shared by the finder and the send-time re-check. */
export function eligibilitySql(cv: string, ai: string, c: string): string {
  return `
        ${ai}."aiState" = 'escalated'
    AND ${ai}."escalatedAt" IS NOT NULL
    AND ${ai}."escalatedAt" >= :maxAgeCutoff
    AND ${ai}."escalatedAt" <= :delayCutoff
    AND ${cv}.channel = 'whatsapp'
    AND ${cv}.state = 'open'
    AND ${cv}."isPersonal" IS NOT TRUE
    AND (:allAgencies::boolean OR ${cv}."agencyId" = ANY(:agencyIds::int[]))
    AND NOT (${cv}."agencyId" = ANY(:excludedAgencyIds::int[]))
    AND (${c}.id IS NULL OR (${c}.status IS DISTINCT FROM 'closed' AND ${c}.status IS DISTINCT FROM 'lost'))
    AND NOT EXISTS (
      SELECT 1 FROM inbox_messages h
       WHERE h."conversationId" = ${cv}.id
         AND COALESCE(h."channelTimestamp", h."createdAt") >= ${ai}."escalatedAt"
         AND ${humanOutboundSql('h')}
    )`
}

export function windowBindings(now: Date, scope: AgencyScope) {
  return {
    maxAgeCutoff: new Date(now.getTime() - REMINDER_MAX_AGE_MS),
    delayCutoff: new Date(now.getTime() - REMINDER_DELAY_MS),
    cooldownCutoff: new Date(now.getTime() - REMINDER_COOLDOWN_MS),
    ...scopeBindings(scope),
  }
}

/** No other reminder for this conversation is pending, and none was sent in the cooldown. */
export function cooldownSql(cv: string, excludeReminderSql = 'NULL'): string {
  return `
    NOT EXISTS (
      SELECT 1 FROM owner_whatsapp_reminders r
       WHERE r."conversationId" = ${cv}.id AND r.status = 'scheduled' AND r.id IS DISTINCT FROM ${excludeReminderSql}
    )
    AND NOT EXISTS (
      SELECT 1 FROM owner_whatsapp_reminder_deliveries d
       WHERE d."conversationId" = ${cv}.id
         AND d.status IN ('sending','sent','unknown')
         AND d."updatedAt" >= :cooldownCutoff
         AND d."reminderId" IS DISTINCT FROM ${excludeReminderSql}
    )`
}

export async function findReminderCandidates(now: Date, scope: AgencyScope, limit: number): Promise<ReminderCandidate[]> {
  if (isEmptyScope(scope)) return []
  const { rows } = await db.raw(
    `SELECT cv.id AS "conversationId", cv."agencyId", cv."leadId", cv."customerWaId", ai."escalatedAt", ai."escalatedAt"::text AS "escalatedAtExact", c."handlerId"
       FROM conversation_ai_state ai
       JOIN inbox_conversations cv ON cv.id = ai."conversationId" AND cv."agencyId" = ai."agencyId"
       LEFT JOIN clients c ON c.id = cv."leadId" AND c."agencyId" = cv."agencyId"
      WHERE ${eligibilitySql('cv', 'ai', 'c')}
        AND NOT EXISTS (
          SELECT 1 FROM owner_whatsapp_reminders e
           WHERE e."conversationId" = cv.id AND e."escalatedAt" = ai."escalatedAt"
        )
        AND ${cooldownSql('cv')}
      ORDER BY ai."escalatedAt" ASC, cv.id ASC
      LIMIT :limit`,
    { ...windowBindings(now, scope), limit },
  )
  return rows.map((r: Record<string, unknown>) => ({
    conversationId: Number(r.conversationId),
    agencyId: Number(r.agencyId),
    leadId: r.leadId == null ? null : Number(r.leadId),
    handlerUserId: r.handlerId == null ? null : Number(r.handlerId),
    customerWaId: (r.customerWaId as string | null) ?? null,
    escalatedAt: new Date(r.escalatedAt as string),
    escalatedAtExact: String(r.escalatedAtExact),
  }))
}

/** Active, verified recipients whose user is still in the same agency and not suspended. */
export async function loadActiveRecipients(agencyIds: number[], q: Knex | Knex.Transaction = db): Promise<Map<number, ActiveRecipient[]>> {
  const out = new Map<number, ActiveRecipient[]>()
  if (!agencyIds.length) return out
  const rows = await q('owner_whatsapp_recipients as r')
    .join('users as u', function () {
      this.on('u.id', '=', 'r.userId').andOn('u.agencyId', '=', 'r.agencyId')
    })
    .whereIn('r.agencyId', agencyIds)
    .where('r.status', 'active')
    .whereNotNull('r.phoneE164')
    .whereNotNull('r.verifiedAt')
    .whereRaw('u.suspended IS NOT TRUE')
    .select('r.id', 'r.agencyId', 'r.userId', 'r.phoneE164', 'r.verifiedAt', 'u.role')
  for (const r of rows) {
    const list = out.get(Number(r.agencyId)) ?? []
    list.push({ recipientId: Number(r.id), userId: Number(r.userId), role: String(r.role), phoneE164: r.phoneE164, verifiedAt: new Date(r.verifiedAt) })
    out.set(Number(r.agencyId), list)
  }
  return out
}
