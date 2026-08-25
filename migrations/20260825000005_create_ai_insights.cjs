/**
 * ai_insights — the durable CONCLUSION, with a life of its own.
 *
 * WHY THIS CANNOT LIVE IN `notifications`. Three properties of that table are
 * correct for notifications and fatal for conclusions:
 *
 *   1. READING RELEASES THE KEY. `notifications_collapse_open_uniq` is partial on
 *      `readAt IS NULL` deliberately — once a rep has dealt with an item, the next
 *      arrival is genuinely new work. But a rep reading "this ליד has gone quiet"
 *      must not entitle the system to say it again tomorrow. Dedup for a
 *      conclusion has to survive being read, and there it structurally cannot.
 *   2. A CONCLUSION IS AGENCY-SCOPED; A NOTIFICATION IS PER-RECIPIENT. One insight
 *      fans out to N recipients and therefore N rows. None of them IS the
 *      conclusion: nowhere to mark superseded once, nowhere to hang the evidence
 *      once, and two copies of a reasoning chain that can diverge.
 *   3. NOTIFICATIONS ARE PURGED. `pruneNotifications` deletes read-and-resolved
 *      rows past a window — right for a bell. Constitution XI.8 requires every
 *      judgement that touched a relationship to stay walkable to its evidence, so
 *      the reasoning chain must outlive the delivery that announced it.
 *
 * AND IT IS NOT `ai_investigations` EITHER. That table records a RUN — immutable,
 * one row per model call. This records a CONCLUSION — mutable, with a lifecycle,
 * and potentially reaffirmed by several runs. Different cardinality, different
 * lifetime, different mutability. Merging them would mean either mutating an audit
 * record or writing a new audit record every time a status changed.
 *
 * THE DEDUP IDENTITY. `insightKey` is `{subjectType}:{subjectId}:{expectation}` and
 * contains NO MODEL OUTPUT — not the conclusion text, not a class the model chose,
 * not the moment. A key derived from what the model said would let a reworded
 * conclusion become a "new" insight: the model gaming its own deduplication by
 * paraphrasing. Every component is established before the model runs.
 *
 * `ai_insights_open_uniq` is partial on `status = 'open'`, so exactly one live
 * conclusion exists per subject per expectation. A second investigation reaching
 * the same conclusion cannot insert; it supersedes.
 *
 * DELIVERY IS A SEPARATE AXIS AND IS NOT STORED AS STATUS. `notificationJobId` and
 * `deliveredAt` record what happened; a dead delivery job does NOT move `status`.
 * The conclusion is still true — we merely failed to tell anyone. That is exactly
 * what makes delivery failure and investigation failure different things.
 *
 * Additive, isolated, reversible: no foreign key into a production table,
 * `agencyId` on the row so every read is tenant-scoped without a join, and
 * `down()` drops it independently.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_insights (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      -- {subjectType}:{subjectId}:{expectation}. Deterministic business identity
      -- only; see the header. Never contains model output.
      "insightKey" text NOT NULL,
      "subjectType" text NOT NULL CHECK ("subjectType" IN ('lead')),
      "subjectId" text NOT NULL,
      expectation text NOT NULL,
      -- The run that produced it. Links conclusion to audit record.
      "investigationId" text NOT NULL,
      -- Whose permissions bounded the evidence read. Delivery must resolve to the
      -- SAME identity or the insight is invalidated rather than delivered.
      "operatorUserId" integer NOT NULL,
      -- Post-gate content ONLY. Raw model output never reaches this table.
      headline text NOT NULL,
      claims jsonb NOT NULL,
      -- Refs the TOOLS produced. The model never writes here.
      evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      -- Constitution XI.8: the judgement stays walkable to its evidence forever.
      "reasoningChain" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "decisionTrace" jsonb NOT NULL DEFAULT '[]'::jsonb,
      -- VALIDITY of the conclusion. Never delivery state.
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','superseded','resolved','expired')),
      "supersededById" bigint,
      "resolvedReason" text
        CHECK ("resolvedReason" IS NULL OR "resolvedReason" IN
               ('business_state','superseded','entity_gone','expired')),
      -- Delivery, owned entirely by the existing notification engine.
      "notificationJobId" bigint,
      "deliveredAt" timestamptz,
      "closedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      -- A terminal row must say why it closed; an open row must not claim to have.
      CONSTRAINT ai_insights_terminal_has_reason
        CHECK ((status = 'open') = ("resolvedReason" IS NULL))
    )`)

  // THE DEDUP INVARIANT: exactly one live conclusion per subject per
  // expectation. Partial on status='open', so reading a NOTIFICATION can never
  // release it — which is the whole reason this table exists.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_insights_open_uniq
      ON ai_insights ("agencyId", "insightKey") WHERE status = 'open'`)

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_insights_investigation_uniq
      ON ai_insights ("agencyId", "investigationId")`)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_insights_subject_idx
      ON ai_insights ("agencyId", "subjectType", "subjectId", "createdAt" DESC)`)

  // The resolution sweep and the daily delivery cap.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_insights_open_sweep_idx
      ON ai_insights ("createdAt") WHERE status = 'open'`)

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS ai_insights_delivered_idx
      ON ai_insights ("agencyId", "deliveredAt") WHERE "deliveredAt" IS NOT NULL`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS ai_insights`)
}
