import { db } from '@/config/db'
import { mapRejectionReason, mapTemplateStatus } from './statusCopy'

/**
 * Apply a Meta `message_template_status_update` / `_quality_update` webhook to the
 * local projection. The spine of the status lifecycle (mirrors the shipped
 * `ingestWhatsappStatuses` discipline).
 *
 * Contract:
 *  - Meta is the only source of truth; we adopt the event, never invent status.
 *  - Idempotent: a single UPDATE keyed by Meta identity (wabaId, name, language).
 *    Re-applying the same event is a no-op-equivalent write.
 *  - Unknown template (0 rows) → structured WARN, never an INSERT.
 *  - Tenant resolved from the WABA id (entry.id) → whatsapp_connections.
 *  - Never throws (the webhook must always answer 200), never sends anything.
 */

type StatusValue = {
  event?: string
  message_template_name?: string
  message_template_language?: string
  reason?: string | null
  new_quality_score?: string
}

function warn(reason: string, ctx: Record<string, unknown>): void {
  // Structured logging, no message content.
  console.warn('[WhatsappWebhook][template] not applied', { reason, ...ctx })
}

export async function ingestTemplateStatusUpdate(
  wabaId: string | undefined,
  field: string,
  rawValue: unknown,
): Promise<void> {
  if (!wabaId) return warn('no_waba', { field })

  const value = (rawValue ?? {}) as StatusValue
  const name = value.message_template_name
  const language = value.message_template_language || 'he'
  if (!name) return warn('no_template_name', { wabaId, field })

  const connection = await db('whatsapp_connections').where({ waba_id: wabaId }).first('agency_id')
  if (!connection) return warn('no_connection', { wabaId, name, language, field })

  // Quality update — touch only the quality rating; the approval status is unchanged.
  if (field === 'message_template_quality_update') {
    const updated = await db('whatsapp_templates')
      .where({ wabaId, name, language })
      .update({ qualityRating: value.new_quality_score ?? null, updatedAt: db.fn.now() })
    if (Number(updated) === 0) warn('unknown_template', { wabaId, name, language, field })
    return
  }

  // Status update — adopt Meta's event.
  const status = mapTemplateStatus(value.event)
  const patch: Record<string, unknown> = {
    status,
    // Set the mapped rejection key only when rejected; clear it otherwise so a
    // later (re-)approval doesn't keep stale rejection copy.
    rejectionReason: status === 'rejected' ? mapRejectionReason(value.reason).key : null,
    updatedAt: db.fn.now(),
  }

  const updated = await db('whatsapp_templates').where({ wabaId, name, language }).update(patch)
  if (Number(updated) === 0) {
    warn('unknown_template', { wabaId, name, language, event: value.event })
  }
}
