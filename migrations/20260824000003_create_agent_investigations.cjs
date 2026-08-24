/**
 * Agent investigations — the durable record of what the CRM Agent told a rep.
 *
 * WHY A NEW TABLE, and specifically not `ai_conversations`. The Copilot already
 * has a conversation substrate, and it does not fit this workload on three
 * counts: `ai_conversations."leadId"` is NOT NULL and its uniqueness key is
 * ("agencyId","leadId") WHERE state='active', while the Agent's flagship
 * question — "what needs attention today?" — has no lead at all; that key also
 * makes a thread shared by every rep in an agency, which is the wrong ownership
 * for one rep's own investigation log. Relaxing either would mean altering a
 * live table and its unique index for the benefit of the minority case.
 *
 * So this table is purpose-built and touches nothing that exists. `leadId` is
 * nullable from the start, so a future lead-scoped investigation needs no
 * migration.
 *
 * WHAT MAY BE STORED. Only what survived the trust gate: the validated headline,
 * claims and unknown line, plus the evidence the TOOLS produced. Raw
 * pre-validation model output never reaches this table, and neither does the
 * text of a dropped claim — an unsupported statement is exactly what
 * `validateAgentAnswer` exists to destroy, and persisting it would resurrect it.
 * Only the COUNTS of dropped claims and stripped refs are kept, because how
 * often the gate fires is the signal worth having.
 *
 * Provider and model identifiers are deliberately absent, upholding the same
 * boundary `ai_messages` states: those live only on `ai_runs`.
 *
 * IDEMPOTENCY. `investigationId` is minted once per investigation in
 * lib/agent/run.ts and already correlates every trace line. The unique index on
 * ("agencyId","investigationId") makes a replayed write a no-op, so a retried
 * server action records history once. Two genuinely different investigations by
 * the same rep carry different ids and both persist — the key is the
 * investigation, never the user.
 *
 * `agencyId` is on the row so every read is agency-scoped without a join.
 * ON DELETE CASCADE keeps a lead-scoped investigation from outliving its lead.
 *
 * Additive and reversible. Nothing reads from it yet.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS agent_investigations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,                      -- the rep who asked; scope-derived, never a caller value
      "investigationId" text NOT NULL,                -- minted in lib/agent/run.ts; also the trace correlation id
      "leadId" integer REFERENCES clients(id) ON DELETE CASCADE,  -- null = leadless (the common case today)
      question text NOT NULL,
      status text NOT NULL,                           -- 'answered' | 'refused' | 'failed'
      "stopReason" text NOT NULL,                     -- lib/agent/types.ts StopReason
      answer jsonb,                                   -- VALIDATED answer only; null when not answered
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,    -- refs the tools produced, never the model
      "droppedClaims" integer NOT NULL DEFAULT 0,     -- counts only: the prose itself is never stored
      "strippedRefs" integer NOT NULL DEFAULT 0,
      steps integer NOT NULL DEFAULT 0,
      "failureReason" text,                           -- provider/error message; null when answered or refused
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "completedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // Idempotency: one row per investigation, however many times a request is retried.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS agent_investigations_investigation_uniq
      ON agent_investigations ("agencyId", "investigationId")`)

  // Agency-scoped history, newest first.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_investigations_agency_created_idx
      ON agent_investigations ("agencyId", "createdAt" DESC)`)

  // One rep's own history, newest first.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_investigations_user_created_idx
      ON agent_investigations ("agencyId", "userId", "createdAt" DESC)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS agent_investigations`)
}
