/**
 * ai_investigations — the durable record of an investigation nobody asked for.
 *
 * WHY NOT `agent_investigations`. That table is purpose-built for the INTERACTIVE
 * Agent and its shape says so: `question text NOT NULL` and `userId integer NOT
 * NULL` — the rep's words and the rep who typed them. An autonomous run has
 * neither. Its objective is system-authored from the expectation, and its
 * "user" is a recipient resolved by `handler_or_admin`, not an asker. Relaxing
 * two NOT NULLs on a live table for the benefit of a different workload is
 * exactly the trade that table's own header rejected when it declined to reuse
 * `ai_conversations`. So the shape is copied and the table is not.
 *
 * WHAT MAY BE STORED. Only what survived the trust gate — the validated headline,
 * claims and unknown line, plus the evidence the TOOLS produced. Raw
 * pre-validation model output never reaches this table, and neither does the text
 * of a dropped claim: an unsupported statement is what `validateAgentAnswer`
 * exists to destroy, and persisting it would resurrect it. Only the COUNTS of
 * dropped claims and stripped refs are kept, because how often the gate fires is
 * the signal worth having.
 *
 * WHAT IS DIFFERENT FROM THE INTERACTIVE TABLE, and why:
 *   · `objective` replaces `question` — system-authored, deterministic per
 *     expectation, never model-written and never free text.
 *   · `operatorUserId` replaces `userId` — the recipient whose permissions bounded
 *     the evidence read, carried so the identity that saw the evidence and the
 *     identity that will later receive the insight are provably the same one.
 *   · `costUsd` is present, because an autonomous run settles a durable budget
 *     reservation and the settlement must be auditable against the run.
 *   · `reservationId` links the run to the hold that paid for it. Deliberately not
 *     a foreign key, like every other table in this chain, so it drops cleanly.
 *   · `signalJobId` / `observationKey` link it back to what was observed.
 *   · `gateOutcome` records what the Tool/Action gate decided, so a run that was
 *     correctly silenced is distinguishable from one that failed.
 *
 * NO INSIGHT ROW LIVES HERE. Phase 4.3 records the GateDecision in the existing
 * `ai_shadow_coverage` sink, which already stores a whole decision as jsonb and
 * already admits `reason = 'absence'`. A dedicated insight table earns its place
 * when insights acquire a delivery lifecycle — that is Phase 4.4, and building it
 * now would create a record with no reader.
 *
 * IDEMPOTENCY. `investigationId` is minted once per run in lib/agent/run.ts and
 * already correlates every trace line, so a replayed write is a no-op.
 *
 * Additive, isolated, reversible: no foreign key into a production table,
 * `agencyId` on the row so every read is tenant-scoped without a join, and
 * `down()` drops it independently.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_investigations (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "investigationId" text NOT NULL,
      -- The lease and the observation that caused this run.
      "signalJobId" bigint NOT NULL,
      "observationKey" text NOT NULL,
      expectation text NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead','portfolio')),
      "subjectId" text NOT NULL,
      -- The hold that paid for it, so settlement is auditable against the run.
      "reservationId" bigint,
      -- The recipient whose permissions bounded the evidence read. The SAME
      -- identity that will later receive the insight.
      "operatorUserId" integer NOT NULL,
      -- System-authored, deterministic per expectation. Never model-written.
      objective text NOT NULL,
      status text NOT NULL CHECK (status IN ('answered','refused','failed')),
      "stopReason" text NOT NULL,
      -- What the deterministic Tool/Action gate decided about the answer.
      "gateOutcome" text CHECK ("gateOutcome" IS NULL OR "gateOutcome" IN ('recommend','stay_silent','rejected')),
      "silenceReason" text,
      -- VALIDATED answer only; null when nothing was answered.
      answer jsonb,
      -- Refs the TOOLS produced, never the model.
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      -- Counts only: the dropped prose itself is never stored.
      "droppedClaims" integer NOT NULL DEFAULT 0,
      "strippedRefs" integer NOT NULL DEFAULT 0,
      steps integer NOT NULL DEFAULT 0,
      "costUsd" numeric(10,6) NOT NULL DEFAULT 0 CHECK ("costUsd" >= 0),
      "failureReason" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "completedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // One row per investigation, however many times a write is replayed.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_investigations_investigation_uniq
      ON ai_investigations ("agencyId", "investigationId")`)

  // Agency-scoped history, newest first.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_investigations_agency_created_idx
      ON ai_investigations ("agencyId", "createdAt" DESC)`)

  // "What happened to this lead's investigations?"
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_investigations_subject_idx
      ON ai_investigations ("agencyId", "subjectType", "subjectId", "createdAt" DESC)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_investigations`)
}
