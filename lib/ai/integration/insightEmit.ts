import { notifyEvent as defaultNotifyEvent } from '@/lib/notifications/emit'
import { buildRecipientContext, resolveRecipients } from '@/db/notifications/recipients'
import {
  createInsight as defaultCreateInsight,
  closeInsight as defaultCloseInsight,
  markDelivered as defaultMarkDelivered,
  deliveredCountForDay as defaultDeliveredCount,
  type CreateInsightInput,
  type InsightRow,
} from '@/db/ai/insights'
import { isInsightDeliveryEnabled, INSIGHT_DAILY_CAP } from './insightFlags'
import { isNotificationsAgencyAllowlisted } from '@/lib/notifications/flags'
import { isOwnedByDeterministicNotification } from './notificationOwnership'
import type { ExpectationKind } from './detectors/registry'

/**
 * Recommend → Insight → delivery.
 *
 * The insight is the CONCLUSION and is always recorded when the gate recommends;
 * delivery is a separate, gated, capped attempt that may legitimately not happen.
 * Nothing here lets a delivery outcome change a conclusion's truth.
 *
 * FOUR THINGS THIS MODULE REFUSES TO DO, each because something else already owns
 * it: it does not decide whether a conclusion is worth surfacing (the Value Bar
 * did), does not classify business state (`classifyLead` does), does not build the
 * notification copy (the registry's deterministic builders do), and does not
 * deliver anything itself (`notifyEvent` does).
 */

/** Refractory window for re-alerting after a supersession. */
export const SUPERSEDE_REALERT_MS = 12 * 60 * 60 * 1000

export type EmitOutcome =
  | 'delivered'
  | 'held_daily_cap'
  | 'held_gate_off'
  | 'not_delivered_owner_changed'
  | 'not_delivered_no_recipient'
  | 'suppressed_supersede_refractory'
  | 'duplicate_investigation'
  | 'refused_owned_expectation'

export interface EmitResult {
  outcome: EmitOutcome
  insightId?: number
  supersededId?: number | null
  recipients?: number[]
  detail: string
}

export interface InsightEmitDeps {
  createInsight?: typeof defaultCreateInsight
  closeInsight?: typeof defaultCloseInsight
  markDelivered?: typeof defaultMarkDelivered
  deliveredCountForDay?: typeof defaultDeliveredCount
  notifyEvent?: typeof defaultNotifyEvent
  buildRecipientContext?: typeof buildRecipientContext
  /**
   * Injected like every other dependency so a DECLARED-but-unowned expectation is
   * reachable in a test. Not a policy switch: production always uses the real
   * registry lookup, and `investigationAdmission` never passes an override.
   */
  isOwnedByDeterministicNotification?: typeof isOwnedByDeterministicNotification
}

export interface InsightEmitOptions {
  now?: Date
  leadName?: string | null
  deps?: InsightEmitDeps
}

/** UTC calendar day, matching the cap's window. */
function dayUtc(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export async function emitInsight(
  input: CreateInsightInput & { expectation: string },
  opts: InsightEmitOptions = {},
): Promise<EmitResult> {
  const now = opts.now ?? new Date()
  const d = opts.deps ?? {}
  const createInsight = d.createInsight ?? defaultCreateInsight
  const closeInsight = d.closeInsight ?? defaultCloseInsight
  const markDelivered = d.markDelivered ?? defaultMarkDelivered
  const deliveredCount = d.deliveredCountForDay ?? defaultDeliveredCount
  const notifyEvent = d.notifyEvent ?? defaultNotifyEvent
  const buildContext = d.buildRecipientContext ?? buildRecipientContext
  const isOwned = d.isOwnedByDeterministicNotification ?? isOwnedByDeterministicNotification

  // CONDITION 13, absolute and checked once more at the last possible moment.
  // The Value Bar's C4 and admission's P1 already refuse an owned expectation;
  // this is the third, at the door of the notification engine itself, because a
  // duplicate business fact reaching a rep is the one failure that cannot be
  // taken back.
  // NOTE: an UNDECLARED expectation also lands here, because the registry lookup
  // yields `undefined` and `undefined !== null`. That is the correct fail-closed
  // answer — if nobody has declared whether a deterministic type owns a fact, the
  // AI must not guess — and it means that with today's single declared
  // expectation (`followup.overdue`, which IS owned) Phase 4.4 emits nothing at
  // all until a genuinely unowned detector exists.
  if (isOwned(input.expectation as ExpectationKind)) {
    return { outcome: 'refused_owned_expectation', detail: `'${input.expectation}' is owned or undeclared` }
  }

  // The conclusion is recorded whatever happens to delivery. An undelivered
  // insight is not a lost insight.
  const created = await createInsight(input)
  if (created.created === false) {
    return { outcome: 'duplicate_investigation', detail: 'this investigation already produced an insight' }
  }
  const insight = created.row
  const supersededId = created.supersededId

  // ── Delivery, from here down. None of it can move `status`. ────────────────

  if (!isInsightDeliveryEnabled(insight.agencyId) || !isNotificationsAgencyAllowlisted(insight.agencyId)) {
    return { outcome: 'held_gate_off', insightId: insight.id, supersededId, detail: 'delivery gate is off' }
  }

  // A supersession the rep has recently been told about is updated in place by
  // the notification engine's own collapse; re-alerting inside the window would
  // be telling them the same thing again in different words.
  if (supersededId !== null && (await withinRefractory(supersededId, now, opts))) {
    return {
      outcome: 'suppressed_supersede_refractory',
      insightId: insight.id,
      supersededId,
      detail: 'superseded a recent insight; not re-alerting',
    }
  }

  // THE OWNERSHIP TRAP. Re-resolve with the SAME rule that bounded the evidence.
  // If the answer has changed, ownership changed — which IS a change in business
  // state — and the conclusion was reached through a lens that no longer applies.
  // Delivering to the new owner would notify someone whose permissions never
  // bounded the evidence, so the insight is invalidated instead.
  const leadId = Number(insight.subjectId)
  const context = await buildContext({ leadPairs: [{ agencyId: insight.agencyId, leadId }], agencyIds: [insight.agencyId] })
  const recipients = resolveRecipients({
    rule: 'handler_or_admin',
    agencyId: insight.agencyId,
    leadId,
    context,
  })

  if (recipients.length === 0) {
    await closeInsight(insight.id, 'resolved', 'entity_gone')
    return { outcome: 'not_delivered_no_recipient', insightId: insight.id, supersededId, detail: 'no recipient resolves' }
  }
  if (!recipients.includes(insight.operatorUserId)) {
    await closeInsight(insight.id, 'resolved', 'business_state')
    return {
      outcome: 'not_delivered_owner_changed',
      insightId: insight.id,
      supersededId,
      recipients,
      detail: `evidence was bounded by ${insight.operatorUserId}; owners are now ${recipients.join(',')}`,
    }
  }

  // THE HARD CEILING. Reaching it leaves the insight OPEN and undelivered — it is
  // not dropped and not resolved, so a later day can still surface it.
  const already = await deliveredCount(insight.agencyId, dayUtc(now))
  if (already >= INSIGHT_DAILY_CAP) {
    return {
      outcome: 'held_daily_cap',
      insightId: insight.id,
      supersededId,
      detail: `${already}/${INSIGHT_DAILY_CAP} delivered today; held open for a later attempt`,
    }
  }

  // Exactly-once by the engine's own `eventKey` uniqueness: this emitter may be
  // called any number of times for one insight and exactly one job exists.
  const result = await notifyEvent({
    type: 'lead.insight',
    agencyId: insight.agencyId,
    entityType: 'lead',
    entityId: leadId,
    actorUserId: null,
    occurredAt: now,
    payload: { leadName: opts.leadName ?? null },
  })

  await markDelivered(insight.id, result.enqueued === true ? result.jobId : null)

  return {
    outcome: 'delivered',
    insightId: insight.id,
    supersededId,
    recipients,
    detail: result.enqueued === true ? `job ${result.jobId}` : `notifyEvent: ${result.reason}`,
  }
}

/** Was the superseded insight created inside the re-alert refractory window? */
async function withinRefractory(supersededId: number, now: Date, opts: InsightEmitOptions): Promise<boolean> {
  const { db } = await import('@/config/db')
  const row = (await db('ai_insights').where({ id: supersededId }).first()) as Record<string, unknown> | undefined
  if (!row) return false
  const delivered = row.deliveredAt
  if (delivered == null) return false
  const at = delivered instanceof Date ? delivered.getTime() : Date.parse(String(delivered))
  void opts
  return Number.isFinite(at) && now.getTime() - at < SUPERSEDE_REALERT_MS
}

export type { InsightRow }
