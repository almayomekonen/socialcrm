/**
 * Meta Lead Ads attribution — normalisation of what Meta actually sent.
 *
 * PURE and TOTAL. No DB, no Graph call, no clock. It runs inside a webhook batch
 * where one malformed lead must never strand a sibling, so every unusable input
 * degrades to `null` and nothing throws.
 *
 * TWO SOURCES, deliberately merged here rather than at the call site:
 *   · the signed webhook `change.value` — carries `form_id`, `ad_id`,
 *     `adgroup_id`, `page_id`, `created_time`. Always present, no extra request.
 *   · the Graph lead node — additionally carries campaign / adset / ad NAMES,
 *     `platform` and `is_organic`, but only if the widened field set succeeded.
 *
 * The Graph node WINS where it has a value, because it is the authoritative
 * record; the webhook fills gaps so that a lead still carries its ad and form
 * even when the widened Graph read was refused. Neither source is ever invented.
 *
 * THE ONE RULE THAT MATTERS: never fabricate. An absent campaign name stays
 * null. A CRM that guesses "Summer Promo" because it saw a campaign id is worse
 * than one that admits it does not know — and under the care charter's Law 1 a
 * fabricated business fact ends the relationship permanently.
 */

/** The lead-node fields worth requesting. Ids AND names come from this one read. */
export const LEAD_ATTRIBUTION_GRAPH_FIELDS = [
  'field_data',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'form_id',
  'platform',
  'is_organic',
  'created_time',
].join(',')

/** The shipped, minimal field set. The fallback when the widened read is refused. */
export const LEAD_MINIMAL_GRAPH_FIELDS = 'field_data'

/** The channel a lead arrived through. Drives the `leadSource` prefix. */
export type LeadAdsChannel = 'facebook' | 'instagram'

export type LeadAttribution = {
  leadgenId: string | null
  formId: string | null
  adId: string | null
  adName: string | null
  adsetId: string | null
  adsetName: string | null
  campaignId: string | null
  campaignName: string | null
  pageId: string | null
  /** Meta's own spelling, stored verbatim. Null when it did not say. */
  platform: string | null
  isOrganic: boolean | null
  externalCreatedAt: Date | null
}

/** A non-empty string, or null. Numbers are coerced — Meta sends ids both ways. */
function str(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  // Meta has sent these as strings on some edges; anything else is "unsaid".
  if (v === 'true') return true
  if (v === 'false') return false
  return null
}

/** A plain object, or an empty one. Arrays and functions are not records. */
function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Meta timestamps arrive as unix seconds (webhook) or ISO-8601 (Graph node).
 * An unparseable value is absence, never `new Date()` — a fabricated timestamp
 * would silently corrupt every time-based attribution report built on it.
 */
function when(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v * 1000)
  if (typeof v === 'string' && v.length > 0) {
    const asNumber = Number(v)
    if (Number.isFinite(asNumber) && asNumber > 0 && /^\d+$/.test(v)) return new Date(asNumber * 1000)
    const parsed = Date.parse(v)
    if (Number.isFinite(parsed)) return new Date(parsed)
  }
  return null
}

/** First non-null wins. Graph node is always passed first by the caller. */
function pick<T>(...values: (T | null)[]): T | null {
  for (const v of values) if (v != null) return v
  return null
}

/**
 * Build the attribution record from both sources.
 *
 * `pageId` comes from the caller (the signature-verified `entry.id`), never from
 * a payload body — the same tenancy rule the comments path already follows.
 */
export function buildLeadAttribution(args: {
  leadgenId: string
  pageId: string | null
  /** The signed `change.value` for this leadgen event. */
  webhookValue: unknown
  /** The Graph lead node, when the widened read succeeded. */
  graphNode: unknown
}): LeadAttribution {
  const w = record(args.webhookValue)
  const g = record(args.graphNode)

  return {
    leadgenId: str(args.leadgenId),
    // Graph first, webhook as the gap-filler.
    formId: pick(str(g.form_id), str(w.form_id)),
    // `adgroup_id` is the webhook's spelling of the ad id.
    adId: pick(str(g.ad_id), str(w.ad_id), str(w.adgroup_id)),
    adName: str(g.ad_name),
    adsetId: pick(str(g.adset_id), str(w.adset_id)),
    adsetName: str(g.adset_name),
    campaignId: pick(str(g.campaign_id), str(w.campaign_id)),
    campaignName: str(g.campaign_name),
    pageId: pick(str(args.pageId), str(g.page_id), str(w.page_id)),
    platform: pick(str(g.platform), str(w.platform)),
    isOrganic: pick(bool(g.is_organic), bool(w.is_organic)),
    externalCreatedAt: pick(when(g.created_time), when(w.created_time)),
  }
}

/**
 * Which channel did this lead arrive through?
 *
 * FAIL-SAFE TOWARD FACEBOOK, deliberately and asymmetrically. Meta spells the
 * Instagram placement `ig` on the lead node, but the field is absent whenever
 * the widened Graph read was refused, and its exact vocabulary is Meta's to
 * change. So Instagram is claimed ONLY on an explicit, recognised Instagram
 * value; everything else — absent, unrecognised, or explicitly Facebook — stays
 * `facebook`, which is exactly the behaviour every existing row already has.
 *
 * The asymmetry is the point. Mislabelling a Facebook lead as Instagram would
 * corrupt the channel report the separation exists to create, and would do it
 * invisibly. Leaving an Instagram lead labelled Facebook is the status quo we
 * are improving on, and it is recoverable later from the stored `platform`.
 */
export function channelFromPlatform(platform: string | null | undefined): LeadAdsChannel {
  const p = (platform ?? '').trim().toLowerCase()
  return p === 'ig' || p === 'instagram' ? 'instagram' : 'facebook'
}

/** The composite `leadSource` for an ingested Lead Ads lead. */
export function leadSourceFor(channel: LeadAdsChannel, leadgenId: string): string {
  return `${channel}:${leadgenId}`
}

/**
 * Every `leadSource` an ingested Lead Ads lead could be stored under.
 *
 * THE DEDUP KEY IS NOW TWO KEYS. Before Instagram separation, one leadgen id
 * mapped to exactly one string (`facebook:{id}`) and dedup was an equality
 * check. Now the same id may legitimately have been stored under either prefix
 * — a lead ingested before this shipped is `facebook:`, the same lead
 * redelivered after could resolve to `instagram:` — so every dedup lookup must
 * consider both or a redelivery would create a duplicate lead.
 */
export function leadSourceCandidates(leadgenId: string): string[] {
  return [`facebook:${leadgenId}`, `instagram:${leadgenId}`]
}
