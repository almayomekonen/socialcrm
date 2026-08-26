/**
 * Lead attribution — where an ingested lead actually came from.
 *
 * WHY THIS TABLE EXISTS. Meta sends the answer for free, twice, and the product
 * discarded it both times. The signed `leadgen` webhook body carries `form_id`,
 * `ad_id`, `adgroup_id`, `page_id` and `created_time`; the Graph lead node will
 * additionally return campaign / adset / ad NAMES plus `platform` and
 * `is_organic`. The ingest read `leadgen_id` and nothing else, and fetched
 * `?fields=field_data` and nothing else. So "which campaign produced this lead"
 * was unanswerable — not because the data was unavailable, but because it was
 * dropped at the door. Every day without this is attribution permanently lost.
 *
 * A SEPARATE TABLE, not columns on `clients`. Three reasons:
 *   · `clients` is the product's most-read, most-protected table and this is
 *     provider-shaped data that only ever applies to webhook-ingested leads;
 *   · attribution is written exactly once at ingest and never edited by a user,
 *     so it has a different lifecycle from every column beside it;
 *   · a future provider (Instagram DMs, TikTok) adds rows here rather than
 *     widening `clients` again.
 *
 * ONE ROW PER LEAD. `leadId` is UNIQUE, which is what makes the write
 * idempotent: a Meta redelivery re-runs ingest, the lead dedup returns the
 * existing row, and the attribution insert conflicts and is ignored. Attribution
 * is never overwritten — a later delivery cannot degrade a good record with a
 * sparser one.
 *
 * EVERY VALUE COLUMN IS NULLABLE, BY DESIGN. Meta returns what it returns: an
 * organic lead has no campaign, a permission-limited token may omit names, and a
 * lead form outside an ad set has no adset. NULL means "Meta did not tell us",
 * and nothing in this system may substitute a guess for it — a fabricated
 * campaign name is worse than an absent one.
 *
 * Additive and reversible. Nothing existing reads or writes it before this ships.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS lead_attribution (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider text NOT NULL DEFAULT 'meta',

      -- Provider identities. Text, never integers: Meta ids exceed 2^53 and a
      -- numeric column would silently round them.
      "leadgenId" text,
      "formId" text,
      "adId" text,
      "adName" text,
      "adsetId" text,
      "adsetName" text,
      "campaignId" text,
      "campaignName" text,
      "pageId" text,

      -- 'fb' | 'ig' as Meta spells it, stored verbatim and never normalised
      -- here; the channel decision is made in code from this raw value.
      platform text,
      "isOrganic" boolean,

      -- Meta's own creation moment for the lead, distinct from our ingest time.
      "externalCreatedAt" timestamptz,

      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // The idempotency mechanism: one attribution record per lead, forever.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS lead_attribution_lead_uniq
      ON lead_attribution ("leadId")`)

  // Agency-scoped reporting ("revenue by campaign this quarter").
  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_attribution_agency_campaign_idx
      ON lead_attribution ("agencyId", "campaignId")`)

  // Channel splits (Facebook vs Instagram) without a table scan.
  await knex.raw(`CREATE INDEX IF NOT EXISTS lead_attribution_agency_platform_idx
      ON lead_attribution ("agencyId", platform)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS lead_attribution`)
}
