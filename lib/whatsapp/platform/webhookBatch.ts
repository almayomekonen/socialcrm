import { isCoexistenceWebhookField } from '@/lib/whatsapp/coexistence'

/**
 * How the WhatsApp webhook route shares one Meta delivery between the agency
 * path and the platform number. Pure: no I/O.
 *
 * SPLIT. Every `entry[*].changes[*]` whose `value.metadata.phone_number_id` is
 * the platform number is taken out; the agency path receives the rest. With no
 * platform number configured, or no platform change in the delivery, the agency
 * path receives the ORIGINAL body object, so its behaviour is identical.
 *
 * Matching is by phone number id only, never by WABA id: another number in the
 * same WABA may belong to an agency, and its traffic must stay on the agency
 * path. WABA-level events (template status, account) therefore keep taking the
 * agency path, exactly as today.
 */

type Change = { field?: unknown; value?: any }
type Entry = { changes?: unknown } & Record<string, unknown>

export type WebhookSplit = {
  /** Changes for the platform number, in delivery order. Empty = nothing to do. */
  platform: Change[]
  /** What the agency path should process; null when nothing is left for it. */
  agencyBody: unknown
  /** The `field` of every change left for the agency path. */
  agencyFields: string[]
}

export function splitPlatformWebhook(body: any, platformPhoneNumberId: string | null): WebhookSplit {
  const entries: Entry[] | null = Array.isArray(body?.entry) ? body.entry : null
  if (!platformPhoneNumberId || !entries) return { platform: [], agencyBody: body, agencyFields: [] }

  const isPlatform = (change: Change) => change?.value?.metadata?.phone_number_id === platformPhoneNumberId
  const platform: Change[] = []
  for (const entry of entries) {
    if (Array.isArray(entry?.changes)) platform.push(...(entry.changes as Change[]).filter(isPlatform))
  }
  if (!platform.length) return { platform, agencyBody: body, agencyFields: [] }

  const remaining = entries
    .map((entry) => (Array.isArray(entry?.changes) ? { ...entry, changes: (entry.changes as Change[]).filter((c) => !isPlatform(c)) } : entry))
    .filter((entry) => !Array.isArray(entry?.changes) || (entry.changes as Change[]).length > 0)
  const agencyFields = remaining.flatMap((entry) =>
    Array.isArray(entry?.changes) ? (entry.changes as Change[]).map((c) => String(c?.field ?? '')) : [],
  )
  return { platform, agencyBody: remaining.length ? { ...body, entry: remaining } : null, agencyFields }
}

/**
 * Agency fields whose handling is NOT proven safe to repeat on a redelivery:
 * every Coexistence field and the template lifecycle. Messages and delivery
 * statuses are (message-id dedup, side effects gated on a new insert, statuses
 * only move forward).
 */
export function isReplayUnprovenAgencyField(field: string): boolean {
  return isCoexistenceWebhookField(field) || field === 'message_template_status_update' || field === 'message_template_quality_update'
}

/**
 * The answer to Meta for a delivery that carried platform changes.
 *
 * - The agency path failed (non-2xx): its answer stands, so its own retry
 *   behaviour is unchanged. The platform changes were still processed; a
 *   redelivery repeats them as no-ops by message id.
 * - The platform changes were saved: the agency answer (200 when none).
 * - Saving a platform change failed:
 *     - 500 when every agency change in the delivery is safe to repeat, so Meta
 *       redelivers and the platform change is saved on the retry;
 *     - otherwise 200 and the platform change is LOST, deliberately: replaying
 *       agency state whose repeat-safety is unproven is the worse failure.
 *       `unsavedPlatformEvent` tells the route to log it.
 */
export function platformBatchResponse(input: {
  agencyStatus: number | null
  platformOk: boolean
  agencyFields: string[]
}): { status: number; useAgencyResponse: boolean; unsavedPlatformEvent: boolean } {
  const { agencyStatus, platformOk, agencyFields } = input
  if (agencyStatus !== null && (agencyStatus < 200 || agencyStatus > 299)) {
    return { status: agencyStatus, useAgencyResponse: true, unsavedPlatformEvent: false }
  }
  if (platformOk) return { status: agencyStatus ?? 200, useAgencyResponse: agencyStatus !== null, unsavedPlatformEvent: false }
  if (agencyFields.some(isReplayUnprovenAgencyField)) {
    return { status: 200, useAgencyResponse: agencyStatus !== null, unsavedPlatformEvent: true }
  }
  return { status: 500, useAgencyResponse: false, unsavedPlatformEvent: false }
}
