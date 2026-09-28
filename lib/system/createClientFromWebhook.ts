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
import type { DbErrorInfo } from '@/lib/system/dbErrorInfo'

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
  /**
   * Receives a PII-free description of the DB failure when — and only when —
   * this function is about to return null. The webhook route persists it into
   * `webhook_failures.error_detail`, so a dropped lead can be diagnosed from the
   * dead-letter row instead of inferred from server logs that have since rolled.
   */
  onInsertError?: (detail: string) => void
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
  onInsertError,
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

  /**
   * DEDUP MUST MIRROR THE UNIQUE INDEXES, OR THE LEAD IS DESTROYED.
   *
   * Three indexes decide whether the insert below can succeed:
   *   clients_agency_phone_unique  UNIQUE ("agencyId", phone) WHERE phone IS NOT NULL
   *   clients_agency_email_unique  UNIQUE ("agencyId", email) WHERE email IS NOT NULL
   *   clients_idNum_agencyId_unique
   * All three are AGENCY-SCOPED and none of them care about `leadSource`.
   *
   * The previous checks did not match them on either axis:
   *   - they were NOT scoped by agencyId, so a match in ANOTHER tenant could
   *     "dedup" this lead away and even return that tenant's row to the caller;
   *   - the phone check was filtered to `facebook:%`/`instagram:%`, so an
   *     existing WhatsApp / manual / imported lead with the same phone was
   *     invisible to dedup but still fatal to the insert;
   *   - email was never checked at all, while the index rejects on it.
   * The insert then raised a unique violation, insertLeadSystem returned null,
   * and the lead was permanently lost. Every match is now agency-scoped and
   * source-agnostic, so anything the index would reject is found here first and
   * returned as the existing lead — the same contract the leadId path already had.
   */

  // Priority 1: dedup by leadId. BOTH prefixes, because the same leadgen id may
  // already be stored under `facebook:` (ingested before the split) while this
  // delivery resolves to `instagram:` — checking one would duplicate the lead.
  const existingByLeadId = await db('clients')
    .where({ agencyId })
    .whereIn('leadSource', leadSourceCandidates(leadId))
    .first()
  if (existingByLeadId) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by leadId — skipping. lead id: ${existingByLeadId.id}`)
    return existingByLeadId
  }

  // Priority 2: dedup by phone, agency-scoped and across ALL sources — exactly
  // the rows clients_agency_phone_unique covers.
  if (phone) {
    const existingByPhone = await db('clients').where({ agencyId, phone }).first()
    if (existingByPhone) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by phone — skipping. lead id: ${existingByPhone.id}`)
      return existingByPhone
    }
  }

  // Priority 3: dedup by email — the check that did not exist. Same shape and
  // same scope as clients_agency_email_unique.
  if (email) {
    const existingByEmail = await db('clients').where({ agencyId, email }).first()
    if (existingByEmail) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Duplicate by email — skipping. lead id: ${existingByEmail.id}`)
      return existingByEmail
    }
  }

  const quota = await getQuotaStatus(agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit

  let insertError: DbErrorInfo | null = null
  const lead = await insertLeadSystem({
    firstName,
    // `clients.lastName` is NOT NULL: a missing surname is '', never null (a null
    // here failed the insert and lost the lead).
    lastName: lastName ?? '',
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
  }, { onError: (info) => { insertError = info } })

  if (!lead) {
    /**
     * A concurrent writer may have inserted this same lead between our dedup
     * checks and our insert, in which case the correct answer is that lead, not
     * an error. Re-check all three dedup axes, agency-scoped — the phone and
     * email indexes are what a racing writer would have tripped, and checking
     * only leadSource would report a loss that did not happen.
     *
     * (There is no unique index on `leadSource`; an earlier comment here claimed
     * one and `pg_indexes` does not list it. The real guards are the agency
     * phone/email/idNum indexes.)
     */
    const concurrentLead = await db('clients')
      .where({ agencyId })
      .where((b) => {
        b.whereIn('leadSource', leadSourceCandidates(leadId))
        if (phone) b.orWhere({ phone })
        if (email) b.orWhere({ email })
      })
      .first()
    if (concurrentLead) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Concurrent insert resolved — lead id: ${concurrentLead.id}`)
      return concurrentLead
    }
    const detail = (insertError as DbErrorInfo | null)?.summary ?? 'insertLeadSystem returned null with no driver error'
    console.error(`[FacebookWebhook][create][leadId=${leadId}] insertLeadSystem failed — ${detail}`)
    onInsertError?.(detail)
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
