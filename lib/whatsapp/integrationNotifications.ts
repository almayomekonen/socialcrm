/**
 * WhatsApp → integration.ingestion_failed when createLeadFromWhatsappWebhook
 * returns null (lead received, not persisted). There is no parallel
 * health_status disconnect path for WhatsApp today — do not invent one.
 */

import { notifyEvent } from '@/lib/notifications/emit'

export type WhatsappConnection = {
  id: number
  agency_id: number
}

export async function notifyWhatsappIngestionFailed(
  connection: WhatsappConnection,
  waMessageId: string,
): Promise<void> {
  const externalLeadId = waMessageId.trim()
  if (!externalLeadId) return

  const at = new Date()
  await notifyEvent({
    type: 'integration.ingestion_failed',
    agencyId: connection.agency_id,
    entityType: 'integration',
    entityId: connection.id,
    actorUserId: null,
    occurredAt: at,
    payload: {
      provider: 'whatsapp',
      externalLeadId,
    },
  })
}
