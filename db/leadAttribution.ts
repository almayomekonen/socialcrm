import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { LeadAttribution } from '@/lib/facebook/leadAttribution'

/**
 * Lead attribution — data layer.
 *
 * WRITE-ONCE. `lead_attribution_lead_uniq` makes one row per lead the database's
 * invariant, and the insert conflicts on it and is IGNORED rather than merged.
 * That is the deliberate choice: a Meta redelivery, or a later delivery whose
 * widened Graph read was refused, must never overwrite a complete record with a
 * sparser one. First writer wins because the first writer is the one that had
 * the Graph node.
 *
 * NEVER THROWS. Attribution is valuable, but it is not the lead. It is written
 * immediately after a lead is created inside a webhook that must always answer
 * 200, and losing an attribution row is recoverable — losing the lead is not.
 * Every failure is logged and swallowed, exactly as the transition log does.
 *
 * AGENCY SCOPE. `agencyId` is stored on the row and required on every read, so
 * no report can cross a tenant boundary. It always originates from the
 * `facebook_pages` lookup on the signature-verified Page id, never from a
 * payload body.
 */

export type LeadAttributionRow = LeadAttribution & {
  agencyId: number
  leadId: number
  provider?: string
}

function isPositiveInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * Is there anything worth recording?
 *
 * A record whose every provider field is null carries no information — it would
 * be a row asserting "this lead came from Meta", which `clients.leadSource`
 * already says. Writing it would make the table's row count a lie about how much
 * attribution we actually hold.
 */
export function hasAnyAttribution(a: LeadAttribution): boolean {
  return Boolean(
    a.formId ||
    a.adId ||
    a.adName ||
    a.adsetId ||
    a.adsetName ||
    a.campaignId ||
    a.campaignName ||
    a.platform ||
    a.isOrganic != null ||
    a.externalCreatedAt,
  )
}

/**
 * Persist one lead's attribution. Idempotent, swallowing, best-effort.
 *
 * Returns whether a row was actually written, for the caller's log line only —
 * no caller branches on it, and none should: a false here is never a reason to
 * fail, retry, or alter lead creation.
 */
export async function recordLeadAttribution(row: LeadAttributionRow, executor: Knex | Knex.Transaction = db): Promise<boolean> {
  if (!isPositiveInt(row.agencyId) || !isPositiveInt(row.leadId)) return false
  // `leadgenId` alone is not attribution — it is already the leadSource suffix.
  if (!hasAnyAttribution(row)) return false

  try {
    await executor('lead_attribution')
      .insert({
        agencyId: row.agencyId,
        leadId: row.leadId,
        provider: row.provider ?? 'meta',
        leadgenId: row.leadgenId,
        formId: row.formId,
        adId: row.adId,
        adName: row.adName,
        adsetId: row.adsetId,
        adsetName: row.adsetName,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        pageId: row.pageId,
        platform: row.platform,
        isOrganic: row.isOrganic,
        externalCreatedAt: row.externalCreatedAt,
      })
      .onConflict('leadId')
      .ignore()
    return true
  } catch (err) {
    console.error('[leadAttribution] write failed (swallowed)', {
      leadId: row.leadId,
      agencyId: row.agencyId,
      err: String(err),
    })
    return false
  }
}

/** One lead's attribution. Agency-scoped. Builder only — not executed here. */
export function attributionForLeadQuery(agencyId: number, leadId: number) {
  return db('lead_attribution').where({ agencyId, leadId }).first()
}
