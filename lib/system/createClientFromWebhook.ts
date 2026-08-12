import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { createSystemTask } from '@/lib/system/createSystemTask'
import { getQuotaStatus } from '@/lib/quota'
import { trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { notifyEvent } from '@/lib/notifications/emit'
import { leadDisplayName } from '@/lib/notifications/leadName'

type WebhookLeadInput = {
  firstName: string
  lastName: string | null
  phone: string | null
  email: string | null
  leadId: string
  agencyId: number
  userId: number
}

export async function createLeadFromWebhook({
  firstName,
  lastName,
  phone: rawPhone,
  email,
  leadId,
  agencyId,
  userId,
}: WebhookLeadInput) {
  // Normalize phone → 972XXXXXXXXX before any dedup check or insert
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  // Priority 1: dedup by leadId — stored as 'facebook:{leadId}' in leadSource
  const existingByLeadId = await db('clients')
    .where({ leadSource: `facebook:${leadId}` })
    .first()
  if (existingByLeadId) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by leadId — skipping. lead id: ${existingByLeadId.id}`)
    return existingByLeadId
  }

  // Priority 2: fallback dedup by phone — only when phone is present
  if (phone) {
    const existingByPhone = await db('clients').where({ phone }).whereLike('leadSource', 'facebook:%').first()
    if (existingByPhone) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  const quota = await getQuotaStatus(agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit

  const lead = await insertLeadSystem({
    firstName,
    lastName,
    phone,
    email,
    idNum: `FB_${leadId}`,
    lead: true,
    leadSource: `facebook:${leadId}`,
    agencyId,
    handlerId: userId,
    userId,
    overQuota,
  })

  if (!lead) {
    // The unique index on clients."leadSource" means a concurrent insert for the same leadId
    // will cause insertLeadSystem to fail. Re-check the DB before treating this as a real error.
    const concurrentLead = await db('clients')
      .where({ leadSource: `facebook:${leadId}` })
      .first()
    if (concurrentLead) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[FacebookWebhook][create][leadId=${leadId}] insertLeadSystem failed`)
    return null
  }

  console.log(`[FacebookWebhook][create][leadId=${leadId}] Lead created — id: ${lead.id}`)

  // First delivered value: a real inbound Facebook lead was persisted (once per agency).
  await trackFirstRealLeadOnce(agencyId, 'facebook')

  await createSystemTask({ clientId: lead.id, title: 'ליד חדש מפייסבוק', userId })

  // Customer Automation Engine trigger (ADR-010): genuinely NEW leads only —
  // every dedup path above returns before this line. emitAutomationEvent
  // never throws; emission can never break lead ingestion.
  await emitAutomationEvent({
    trigger: 'lead_created',
    origin: 'webhook_facebook',
    agencyId,
    leadId: lead.id,
    occurredAt: new Date(),
    leadSource: lead.leadSource ?? null,
  })

  /**
   * Notification engine — the case the whole system exists for: a lead arrives
   * from Facebook while nobody is looking at the screen.
   *
   * No actor (a webhook is not a person), so nobody is dropped as self-authored
   * and the assigned handler hears about it. No transaction is available here —
   * the insert above is a bare INSERT — so a crash between the two leaves a lead
   * with no job; the reconciliation sweep (lib/notifications/reconcile.ts) is
   * what recovers it. notifyEvent never throws, so ingestion cannot break.
   */
  await notifyEvent({
    type: 'lead.created',
    agencyId,
    entityType: 'lead',
    entityId: lead.id,
    actorUserId: null,
    occurredAt: new Date(),
    payload: { leadName: leadDisplayName(lead) },
  })

  console.log(`[FacebookWebhook][success][leadId=${leadId}]`)

  return lead
}
