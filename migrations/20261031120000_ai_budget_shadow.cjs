/**
 * AI budget reservations — SHADOW MODE foundations.
 *
 * ai_budget_reservations: one row per provider request (`callId`, the same id
 *   as its ai_usage_events row). Records the conservative upper-bound estimate
 *   reserved BEFORE the call, the would-allow / would-deny decision against the
 *   configured policy, and the reconciliation after it:
 *     reserved → reconciled   (actual cost priced from reported usage)
 *              → failed       (the request errored; charged actual if usage
 *                              was reported, else the estimate)
 *              → unknown_cost (finished, but cost could not be priced; charged
 *                              the estimate — never zero)
 *              → expired      (never settled within the TTL; charged the estimate)
 *   Every transition is guarded on `state = 'reserved'`, so reconciliation and
 *   recovery are idempotent.
 *
 * ai_budget_counters: one row per (scope, window). `reservedUsd` holds open
 *   estimates; settlement moves them into `spentUsd`. Updated with row locks in
 *   a fixed key order, so concurrent reservations serialise and cannot both
 *   see room that only one of them has.
 *
 * SHADOW ONLY: nothing reads these to block, delay or change a request.
 * No message text, prompt, phone number or credential is stored; a contact is
 * a one-way hash.
 *
 * ADDITIVE: two new tables, no foreign keys.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_budget_reservations (
      id bigserial PRIMARY KEY,
      "callId" text NOT NULL,
      mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow')),
      "policyVersion" text NOT NULL,
      "agencyId" integer NULL,
      "operationKind" text NOT NULL,
      "operationId" text NULL,
      "conversationId" bigint NULL,
      "contactKey" text NULL,
      feature text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      "estimateUsd" numeric(12,6) NOT NULL CHECK ("estimateUsd" >= 0),
      "estimateBasis" text NOT NULL CHECK ("estimateBasis" IN ('bounded','partial','unbounded')),
      "costMetadataIncomplete" boolean NOT NULL,
      decision text NOT NULL CHECK (decision IN ('would_allow','would_deny')),
      "denyReasons" text[] NOT NULL DEFAULT '{}',
      "warnScopes" text[] NOT NULL DEFAULT '{}',
      "scopesSkipped" text[] NOT NULL DEFAULT '{}',
      "scopeKeys" text[] NOT NULL DEFAULT '{}',
      state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','reconciled','failed','unknown_cost','expired')),
      "actualUsd" numeric(12,6) NULL,
      "chargedUsd" numeric(12,6) NULL,
      "reservedAt" timestamptz NOT NULL DEFAULT now(),
      "settledAt" timestamptz NULL
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ai_budget_reservations_call_uniq ON ai_budget_reservations ("callId")`)
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS ai_budget_reservations_open_idx ON ai_budget_reservations ("reservedAt") WHERE state = 'reserved'`,
  )
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS ai_budget_reservations_agency_idx ON ai_budget_reservations ("agencyId", "reservedAt")`,
  )
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_budget_counters (
      "scopeKey" text NOT NULL,
      "windowKind" text NOT NULL CHECK ("windowKind" IN ('run','hour','day','period','contact_window')),
      "windowStart" timestamptz NOT NULL,
      "reservedUsd" numeric(14,6) NOT NULL DEFAULT 0,
      "spentUsd" numeric(14,6) NOT NULL DEFAULT 0,
      requests integer NOT NULL DEFAULT 0,
      "unknownCostRequests" integer NOT NULL DEFAULT 0,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("scopeKey", "windowKind", "windowStart")
    )
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_budget_counters`)
  await knex.raw(`DROP TABLE IF EXISTS ai_budget_reservations`)
}
