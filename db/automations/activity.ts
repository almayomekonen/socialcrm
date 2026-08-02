import { db } from '@/config/db'
import type { SkipReason, TriggerOrigin, TriggerType } from '@/lib/automations/types'

/**
 * automation_activity — the append-only user-facing log (migration plan
 * §1.1/§3.2). Content is immutable; the ONE mutable field is deliveryState,
 * updated monotonically (sent → delivered → bounced/failed, never backwards —
 * the inbox_messages ladder precedent). Rows snapshot the lead's display name
 * so history survives lead deletion (no FKs to clients by design).
 *
 * Cap counts take a `since` Date computed by the CALLER in BUSINESS_TZ
 * (lib/today/time.startOfBusinessDayMs) — never date_trunc in SQL, which
 * would bucket in UTC. Counts include would_send rows: observation consumes
 * eligibility (ADR-009).
 *
 * API: appendActivity, listForAutomation, listForLead,
 * countAutomatedToday{ForAgency,ForLead}, updateDeliveryStateByProviderMessageId.
 */

export type ActivityKind = 'sent' | 'would_send' | 'skipped' | 'failed'
export type DeliveryState = 'sent' | 'delivered' | 'bounced' | 'failed'

export async function appendActivity(input: {
  agencyId: number
  automationId: number
  leadId: number
  leadName: string | null
  kind: ActivityKind
  mode: 'live' | 'log'
  trigger: TriggerType
  origin: TriggerOrigin
  skipReason?: SkipReason | null
  subject?: string | null
  deliveryState?: DeliveryState | null
  providerMessageId?: string | null
  contentSchemaVersion?: number | null
}): Promise<void> {
  await db('automation_activity').insert({
    agencyId: input.agencyId,
    automationId: input.automationId,
    leadId: input.leadId,
    leadName: input.leadName,
    kind: input.kind,
    mode: input.mode,
    trigger: input.trigger,
    origin: input.origin,
    skipReason: input.skipReason ?? null,
    subject: input.subject ?? null,
    deliveryState: input.deliveryState ?? null,
    providerMessageId: input.providerMessageId ?? null,
    contentSchemaVersion: input.contentSchemaVersion ?? null,
  })
}

export function listActivityForAutomationQuery(agencyId: number, automationId: number, limit: number) {
  return db('automation_activity')
    .select('*')
    .where({ agencyId, automationId })
    .orderBy('occurredAt', 'desc')
    .limit(limit)
}

export async function listActivityForAutomation(agencyId: number, automationId: number, limit = 100) {
  return listActivityForAutomationQuery(agencyId, automationId, limit)
}

export function listActivityForLeadQuery(agencyId: number, leadId: number, limit: number) {
  return db('automation_activity')
    .select('*')
    .where({ agencyId, leadId })
    .orderBy('occurredAt', 'desc')
    .limit(limit)
}

export async function listActivityForLead(agencyId: number, leadId: number, limit = 50) {
  return listActivityForLeadQuery(agencyId, leadId, limit)
}

// Eligibility-consuming kinds (ADR-009): a would_send counts like a send.
const CONSUMING_KINDS = ['sent', 'would_send'] as const

export function countAutomatedTodayForAgencyQuery(agencyId: number, since: Date) {
  return db('automation_activity')
    .count<{ c: string }[]>({ c: '*' })
    .where({ agencyId })
    .whereIn('kind', CONSUMING_KINDS as unknown as string[])
    .where('occurredAt', '>=', since)
}

export async function countAutomatedTodayForAgency(agencyId: number, since: Date): Promise<number> {
  const rows = await countAutomatedTodayForAgencyQuery(agencyId, since)
  return Number(rows[0]?.c ?? 0)
}

export function countAutomatedTodayForLeadQuery(agencyId: number, leadId: number, since: Date) {
  return db('automation_activity')
    .count<{ c: string }[]>({ c: '*' })
    .where({ agencyId, leadId })
    .whereIn('kind', CONSUMING_KINDS as unknown as string[])
    .where('occurredAt', '>=', since)
}

export async function countAutomatedTodayForLead(agencyId: number, leadId: number, since: Date): Promise<number> {
  const rows = await countAutomatedTodayForLeadQuery(agencyId, leadId, since)
  return Number(rows[0]?.c ?? 0)
}

export type ActivityCounts = { sent: number; wouldSend: number; skipped: number; failed: number }

export function countRecentActivityByAutomationQuery(agencyId: number, since: Date) {
  return db('automation_activity')
    .select('automationId', 'kind')
    .count<{ automationId: number; kind: ActivityKind; c: string }[]>({ c: '*' })
    .where({ agencyId })
    .where('occurredAt', '>=', since)
    .groupBy('automationId', 'kind')
}

/**
 * Per-automation activity counts for the card lines (spec §8: server-backed,
 * or nothing — never a meaningless "0 sent" row). One grouped query for the
 * whole page.
 */
export async function countRecentActivityByAutomation(
  agencyId: number,
  since: Date,
): Promise<Record<number, ActivityCounts>> {
  const rows = await countRecentActivityByAutomationQuery(agencyId, since)
  const out: Record<number, ActivityCounts> = {}
  for (const row of rows) {
    const id = Number(row.automationId)
    out[id] ??= { sent: 0, wouldSend: 0, skipped: 0, failed: 0 }
    const n = Number(row.c ?? 0)
    if (row.kind === 'sent') out[id].sent += n
    else if (row.kind === 'would_send') out[id].wouldSend += n
    else if (row.kind === 'skipped') out[id].skipped += n
    else if (row.kind === 'failed') out[id].failed += n
  }
  return out
}

export function getSendByProviderMessageIdQuery(providerMessageId: string) {
  return db('automation_activity')
    .select('id', 'agencyId', 'automationId', 'leadId')
    .where({ providerMessageId, kind: 'sent' })
    .first()
}

export type OwnedSend = { id: number; agencyId: number; automationId: number; leadId: number }

/**
 * Delivery-event correlation (ADR-012): resolve a provider message id to the
 * engine send row that owns it. `null` means the event is NOT ours — the
 * provider account is shared with platform email, so a miss is the runtime
 * domain boundary, not an error. Correlation is by the provider's immutable
 * id only; never by address, subject, or timestamp.
 */
export async function getSendByProviderMessageId(providerMessageId: string): Promise<OwnedSend | null> {
  const row = (await getSendByProviderMessageIdQuery(providerMessageId)) as OwnedSend | undefined
  return row ?? null
}

export function hasConsumingActivityQuery(automationId: number, leadId: number) {
  return db('automation_activity')
    .select('id')
    .where({ automationId, leadId })
    .whereIn('kind', CONSUMING_KINDS as unknown as string[])
    .first()
}

/** Crash-recovery idempotency check (ADR-011): did the effect row already land? */
export async function hasConsumingActivity(automationId: number, leadId: number): Promise<boolean> {
  return Boolean(await hasConsumingActivityQuery(automationId, leadId))
}

// One-way ladder rank; transitions never move backwards.
const DELIVERY_RANK: Record<DeliveryState, number> = { sent: 1, delivered: 2, bounced: 3, failed: 3 }

export function updateDeliveryStateQuery(providerMessageId: string, next: DeliveryState) {
  // Monotonic guard in SQL (ingestWhatsappStatuses precedent): update only
  // rows whose current state ranks strictly lower than the incoming one.
  return db.raw(
    `
    UPDATE automation_activity
       SET "deliveryState" = :next
     WHERE "providerMessageId" = :providerMessageId
       AND kind = 'sent'
       AND COALESCE(
             CASE "deliveryState"
               WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
               WHEN 'bounced' THEN 3 WHEN 'failed' THEN 3
             END, 0) < :rank
  `,
    { providerMessageId, next, rank: DELIVERY_RANK[next] },
  )
}

export async function updateDeliveryStateByProviderMessageId(
  providerMessageId: string,
  next: DeliveryState,
): Promise<number> {
  const res = await updateDeliveryStateQuery(providerMessageId, next)
  return res.rowCount ?? 0
}
