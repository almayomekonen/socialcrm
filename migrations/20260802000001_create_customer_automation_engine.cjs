/**
 * Customer Automation Engine — Phase 2 storage. Additive, zero-downtime.
 *
 * Creates the six engine stores approved in
 * docs/customer-automation-engine-migration-plan.md (ADR-008/ADR-009):
 *   automation_definitions       — user-authored automations (soft delete only)
 *   automation_jobs              — execution queue (prunable plumbing)
 *   automation_send_claims       — once-per-lead-per-automation memory (permanent)
 *   automation_activity          — append-only user-facing log (permanent)
 *   automation_lead_suppressions — consent: lead unsubscribed (permanent)
 *   automation_email_blocks      — deliverability: address hard-bounced (permanent)
 *
 * Boundary: customer-automation domain ONLY (spec §0). No platform-email
 * table is touched; no existing table is altered. Leads/agencies are
 * referenced by id WITHOUT foreign keys — history must survive lead deletion
 * (activity snapshots the lead name instead). Engine-internal references to
 * automation_definitions are plain RESTRICT-style FKs; definitions are never
 * hard-deleted (soft delete), so they always resolve.
 *
 * ROLLBACK POLICY: the down-path below is valid ONLY before the first live
 * send (Phase 7). From that point claims/suppressions/activity are
 * legal/behavioral memory and this migration is forward-only in production —
 * behavior rollback is flags, never schema (migration plan §2.2).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_definitions (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      name text NOT NULL,
      "recipeKey" text,
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','paused','deleted')),
      trigger text NOT NULL CHECK (trigger IN ('lead_created','status_changed')),
      "targetStatus" text,
      "sourceFilter" text,
      action text NOT NULL DEFAULT 'send_email' CHECK (action IN ('send_email')),
      content jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdByUserId" integer NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "activatedAt" timestamptz, "pausedAt" timestamptz, "deletedAt" timestamptz
    )`)
  // List page (small per-agency sets):
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_definitions_agency_idx
      ON automation_definitions ("agencyId")`)
  // Emission gate: "any active automation for this trigger?" — partial, so the
  // lookup scans only live definitions (partial-index house precedent):
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_definitions_active_trigger_idx
      ON automation_definitions ("agencyId", trigger) WHERE status = 'active'`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_jobs (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "automationId" integer NOT NULL REFERENCES automation_definitions(id),
      "leadId" integer NOT NULL,
      trigger text NOT NULL CHECK (trigger IN ('lead_created','status_changed')),
      origin text NOT NULL
        CHECK (origin IN ('webhook_facebook','webhook_whatsapp','manual','import')),
      "eventKey" text NOT NULL,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','done','skipped','failed','dead')),
      attempts integer NOT NULL DEFAULT 0,
      "maxAttempts" integer NOT NULL DEFAULT 3,
      "notBefore" timestamptz NOT NULL DEFAULT now(),
      "lockedAt" timestamptz, "lockedBy" text,
      "skipReason" text, "lastError" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  // Webhook-retry dedup — the enqueue's ON CONFLICT target:
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_jobs_dedup_uniq
      ON automation_jobs ("automationId","leadId","eventKey")`)
  // Worker claim scans only the live set (partial on pending, by due time):
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_jobs_claim_idx
      ON automation_jobs ("notBefore") WHERE status = 'pending'`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_send_claims (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "automationId" integer NOT NULL REFERENCES automation_definitions(id),
      "leadId" integer NOT NULL,
      semantics text NOT NULL DEFAULT 'ever' CHECK (semantics IN ('ever')),
      mode text NOT NULL CHECK (mode IN ('live','log')),
      status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','confirmed')),
      "claimedAt" timestamptz NOT NULL DEFAULT now(),
      "confirmedAt" timestamptz
    )`)
  // The once-ever memory IS this unique key (ADR-005; mode-agnostic per ADR-009):
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_send_claims_once_uniq
      ON automation_send_claims ("automationId","leadId",semantics)`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_activity (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "automationId" integer NOT NULL REFERENCES automation_definitions(id),
      "leadId" integer NOT NULL,
      "leadName" text,
      kind text NOT NULL CHECK (kind IN ('sent','would_send','skipped','failed')),
      mode text NOT NULL CHECK (mode IN ('live','log')),
      "skipReason" text,
      subject text,
      "deliveryState" text
        CHECK ("deliveryState" IN ('sent','delivered','bounced','failed')),
      "providerMessageId" text,
      "contentSchemaVersion" integer,
      trigger text NOT NULL,
      origin text NOT NULL,
      "occurredAt" timestamptz NOT NULL DEFAULT now()
    )`)
  // The per-automation log view (newest first):
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_activity_automation_time_idx
      ON automation_activity ("automationId","occurredAt")`)
  // Lead timeline + per-lead daily cap count:
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_activity_lead_time_idx
      ON automation_activity ("agencyId","leadId","occurredAt")`)
  // Agency daily ceiling count:
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_activity_agency_time_idx
      ON automation_activity ("agencyId","occurredAt")`)
  // Delivery-event correlation (Phase 5 webhook resolves by provider id) —
  // partial: only send rows carry one:
  await knex.raw(`CREATE INDEX IF NOT EXISTS automation_activity_provider_msg_idx
      ON automation_activity ("providerMessageId") WHERE "providerMessageId" IS NOT NULL`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_lead_suppressions (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "leadId" integer NOT NULL,
      source text NOT NULL DEFAULT 'unsubscribe_link',
      "unsubscribedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_lead_suppressions_uniq
      ON automation_lead_suppressions ("agencyId","leadId")`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS automation_email_blocks (
      id serial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "emailNormalized" text NOT NULL,
      reason text NOT NULL DEFAULT 'hard_bounce',
      "blockedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS automation_email_blocks_uniq
      ON automation_email_blocks ("agencyId","emailNormalized")`)
}

/**
 * Valid ONLY pre-live (see header). Reverse dependency order.
 * @param {import('knex').Knex} knex
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS automation_email_blocks`)
  await knex.raw(`DROP TABLE IF EXISTS automation_lead_suppressions`)
  await knex.raw(`DROP TABLE IF EXISTS automation_activity`)
  await knex.raw(`DROP TABLE IF EXISTS automation_send_claims`)
  await knex.raw(`DROP TABLE IF EXISTS automation_jobs`)
  await knex.raw(`DROP TABLE IF EXISTS automation_definitions`)
}
