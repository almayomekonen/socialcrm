import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { createSystemTask } from '@/lib/system/createSystemTask'
import { getQuotaStatus } from '@/lib/quota'
import { trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { emitLeadCreated } from '@/lib/notifications/emitLeadCreated'
import { leadDisplayName } from '@/lib/notifications/leadName'

type WhatsappWebhookLeadInput = {
  firstName: string
  lastName: string | null
  phone: string | null
  messageId: string
  agencyId: number
  userId: number
}

export async function createLeadFromWhatsappWebhook({
  firstName,
  lastName,
  phone: rawPhone,
  messageId,
  agencyId,
  userId,
}: WhatsappWebhookLeadInput) {
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  // Priority 1: dedup by messageId — exact match on leadSource
  const existingByMessageId = await db('clients')
    .where({ leadSource: `whatsapp:${messageId}` })
    .first()
  if (existingByMessageId) {
    console.log(
      `[WhatsappWebhook][dedup][msgId=${messageId}] Duplicate by messageId — skipping. lead id: ${existingByMessageId.id}`,
    )
    return existingByMessageId
  }

  // Priority 2: dedup by phone — global across all sources
  if (phone) {
    const existingByPhone = await db('clients').where({ phone, agencyId }).first()
    if (existingByPhone) {
      console.log(`[WhatsappWebhook][dedup][msgId=${messageId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  const quota = await getQuotaStatus(agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit

  const lead = await insertLeadSystem({
    firstName,
    lastName,
    phone,
    email: null,
    idNum: `WA_${messageId}`,
    lead: true,
    leadSource: `whatsapp:${messageId}`,
    agencyId,
    handlerId: userId,
    userId,
    overQuota,
  })

  if (!lead) {
    // Concurrent insert guard — same as Facebook pattern
    const concurrentLead = await db('clients')
      .where({ leadSource: `whatsapp:${messageId}` })
      .first()
    if (concurrentLead) {
      console.log(`[WhatsappWebhook][dedup][msgId=${messageId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[WhatsappWebhook][create][msgId=${messageId}] insertLeadSystem failed`)
    return null
  }

  console.log(`[WhatsappWebhook][create][msgId=${messageId}] Lead created — id: ${lead.id}`)

  // First delivered value: a real inbound WhatsApp lead was persisted (once per agency).
  await trackFirstRealLeadOnce(agencyId, 'whatsapp')

  await createSystemTask({ clientId: lead.id, title: 'ליד חדש מוואטסאפ', userId })

  // Customer Automation Engine trigger (ADR-010): genuinely NEW leads only —
  // every dedup path above returns before this line. emitAutomationEvent
  // never throws; emission can never break lead ingestion.
  await emitAutomationEvent({
    trigger: 'lead_created',
    origin: 'webhook_whatsapp',
    agencyId,
    leadId: lead.id,
    occurredAt: new Date(),
    leadSource: lead.leadSource ?? null,
  })

  // Shared lead.created door — same contract as Facebook (no actor, no trx).
  await emitLeadCreated({
    agencyId,
    leadId: lead.id,
    leadName: leadDisplayName(lead),
    actorUserId: null,
    occurredAt: new Date(),
    origin: 'webhook_whatsapp',
  })

  console.log(`[WhatsappWebhook][success][msgId=${messageId}]`)

  return lead
}
