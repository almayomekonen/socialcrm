import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { createSystemTask } from '@/lib/system/createSystemTask'
import { getQuotaStatus } from '@/lib/quota'
import { trackFirstRealLeadOnce } from '@/lib/analytics/track'
import { emitAutomationEvent } from '@/lib/automations/emit'
import { emitLeadCreated } from '@/lib/notifications/emitLeadCreated'
import { leadDisplayName } from '@/lib/notifications/leadName'
import {
  channelFromPlatform,
  leadSourceCandidates,
  leadSourceFor,
  type LeadAttribution,
} from '@/lib/facebook/leadAttribution'
import { recordLeadAttribution } from '@/db/leadAttribution'

type WebhookLeadInput = {
  firstName: string
  lastName: string | null
  phone: string | null
  email: string | null
  leadId: string
  agencyId: number
  userId: number
  /**
   * What Meta said about where this lead came from. Optional so existing callers
   * and tests are unaffected; absent means the channel resolves to `facebook`,
   * which is the exact behaviour every lead had before Instagram separation.
   */
  attribution?: LeadAttribution
}

export async function createLeadFromWebhook({
  firstName,
  lastName,
  phone: rawPhone,
  email,
  leadId,
  agencyId,
  userId,
  attribution,
}: WebhookLeadInput) {
  // Normalize phone → 972XXXXXXXXX before any dedup check or insert
  const digits = rawPhone?.replace(/\D/g, '') ?? ''
  const phone = digits.length >= 9 ? (digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '')) : null

  /**
   * Which channel this lead actually arrived through. Meta delivers Instagram
   * and Facebook Lead Ads over the SAME `leadgen` webhook, and both were stored
   * as `facebook:{leadId}` — so Instagram was not separable in the data at all.
   * `channelFromPlatform` claims Instagram only on an explicit, recognised
   * platform value and otherwise returns `facebook`, so every lead that is
   * classified today keeps its exact current classification.
   */
  const channel = channelFromPlatform(attribution?.platform)
  const leadSource = leadSourceFor(channel, leadId)

  // Priority 1: dedup by leadId. BOTH prefixes, because the same leadgen id may
  // already be stored under `facebook:` (ingested before the split) while this
  // delivery resolves to `instagram:` — checking one would duplicate the lead.
  const existingByLeadId = await db('clients').whereIn('leadSource', leadSourceCandidates(leadId)).first()
  if (existingByLeadId) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by leadId — skipping. lead id: ${existingByLeadId.id}`)
    return existingByLeadId
  }

  // Priority 2: fallback dedup by phone — only when phone is present.
  // Semantics preserved exactly (still Lead-Ads-sourced rows only); the match is
  // merely widened to the Instagram prefix so the split cannot reintroduce the
  // duplicate this check exists to prevent.
  if (phone) {
    const existingByPhone = await db('clients')
      .where({ phone })
      .where((b) => b.whereLike('leadSource', 'facebook:%').orWhereLike('leadSource', 'instagram:%'))
      .first()
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
    leadSource,
    agencyId,
    handlerId: userId,
    userId,
    overQuota,
    // The durable create-path origin stays 'facebook' for both channels: it
    // records HOW the lead entered (the Meta Lead Ads webhook), which is the
    // same door for Instagram. Which PLACEMENT it came from is `leadSource` and
    // `lead_attribution.platform`. `createOrigin` is also CHECK-constrained to
    // an existing vocabulary, and widening it is a separate, breaking decision.
    createOrigin: 'facebook',
  })

  if (!lead) {
    // The unique index on clients."leadSource" means a concurrent insert for the same leadId
    // will cause insertLeadSystem to fail. Re-check the DB before treating this as a real error.
    // Both prefixes again — a concurrent writer may have resolved the other channel.
    const concurrentLead = await db('clients').whereIn('leadSource', leadSourceCandidates(leadId)).first()
    if (concurrentLead) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    console.error(`[FacebookWebhook][create][leadId=${leadId}] insertLeadSystem failed`)
    return null
  }

  console.log(`[FacebookWebhook][create][leadId=${leadId}] Lead created — id: ${lead.id} channel=${channel}`)

  /**
   * Attribution, written immediately after the lead exists and BEFORE the
   * notification/automation fan-out, so a report can never see a lead whose
   * attribution has not landed yet. Never throws and never blocks: a lead
   * without attribution is a working lead, a lost lead is not.
   */
  if (attribution) {
    await recordLeadAttribution({
      ...attribution,
      agencyId,
      leadId: Number(lead.id),
    })
  }

  // First delivered value: a real inbound Facebook lead was persisted (once per agency).
  await trackFirstRealLeadOnce(agencyId, 'facebook')

  // Channel-accurate task title — a rep opening the task should see where the
  // ליד actually came from, which is the whole point of separating the two.
  await createSystemTask({
    clientId: lead.id,
    title: channel === 'instagram' ? 'ליד חדש מאינסטגרם' : 'ליד חדש מפייסבוק',
    userId,
  })

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

  // Shared lead.created door. No actor (webhook); no trx — reconcile recovers
  // a crash between insertLeadSystem and this line.
  await emitLeadCreated({
    agencyId,
    leadId: lead.id,
    leadName: leadDisplayName(lead),
    actorUserId: null,
    occurredAt: new Date(),
    origin: 'webhook_facebook',
  })

  console.log(`[FacebookWebhook][success][leadId=${leadId}]`)

  return lead
}
