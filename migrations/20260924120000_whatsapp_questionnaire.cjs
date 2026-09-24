/**
 * WhatsApp deterministic questionnaire — Phase 1. Additive, reversible.
 *
 * Three pieces:
 *
 *   1. auto_response_settings."responder" — which engine answers this business:
 *      the existing AI agent, or the deterministic questionnaire. A SEPARATE
 *      column rather than a third `mode` value, because the owner-facing save
 *      rewrites `mode` from `replyMode` (actions/autoResponse/updateSettings.ts)
 *      and an unrecognised `mode` is read back as 'acknowledge' — which is an AI
 *      acknowledgement. A questionnaire business must never be one owner save
 *      away from an AI reply. The CHECK is deliberate: a typo must be rejected
 *      at write time, because the read path treats anything that is not
 *      'questionnaire' as 'agent'.
 *
 *   2. auto_response_settings."questionnaire" — the definition, one per
 *      (agency, channel). Validated by zod on write and on read.
 *
 *   3. questionnaire_sessions — per-conversation progress. Separate from
 *      conversation_ai_state because a conversation can hold several sessions
 *      over its life and because that row (and its migration) is frozen by
 *      instruction. Ownership still lives in conversation_ai_state."aiState",
 *      so the Human Presence send guard keeps working unchanged.
 *
 * The widened auto_response_jobs reason CHECK follows the established
 * lookup-by-definition pattern (20260625000002, 20260819120000): the constraint
 * is found by its definition rather than by a name that differs between the
 * baseline and a freshly migrated database.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasResponder = await knex.schema.hasColumn('auto_response_settings', 'responder')
  if (!hasResponder) {
    await knex.raw(`ALTER TABLE auto_response_settings
      ADD COLUMN responder text NOT NULL DEFAULT 'agent'`)
    await knex.raw(`ALTER TABLE auto_response_settings
      ADD CONSTRAINT auto_response_settings_responder_check
      CHECK (responder IN ('agent','questionnaire'))`)
  }

  const hasQuestionnaire = await knex.schema.hasColumn('auto_response_settings', 'questionnaire')
  if (!hasQuestionnaire) {
    await knex.raw(`ALTER TABLE auto_response_settings ADD COLUMN questionnaire jsonb`)
  }

  await knex.raw(`
    DO $$
    DECLARE cn text;
    BEGIN
      SELECT conname INTO cn FROM pg_constraint
        WHERE conrelid = 'auto_response_jobs'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%reason%';
      IF cn IS NOT NULL THEN
        EXECUTE 'ALTER TABLE auto_response_jobs DROP CONSTRAINT ' || quote_ident(cn);
      END IF;
    END $$;`)
  await knex.raw(`ALTER TABLE auto_response_jobs
    ADD CONSTRAINT auto_response_jobs_reason_check
    CHECK (reason IN ('first_contact','qualify_turn','no_response_warning','no_response_close','questionnaire_turn'))`)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS questionnaire_sessions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "conversationId" bigint NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "leadId" integer REFERENCES clients(id) ON DELETE SET NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','completed','handed_off','opted_out','human_took_over','needs_review')),
      "endedReason" text,
      definition jsonb NOT NULL,
      "definitionRevision" integer NOT NULL DEFAULT 1,
      "currentStepId" text,
      answers jsonb NOT NULL DEFAULT '{}'::jsonb,
      "invalidCount" integer NOT NULL DEFAULT 0,
      "lastConsumedSequence" bigint NOT NULL DEFAULT 0,
      "lastPromptAt" timestamptz,
      version integer NOT NULL DEFAULT 0,
      "pendingTransition" jsonb,
      "pendingClaimedAt" timestamptz,
      "startedAt" timestamptz NOT NULL DEFAULT now(),
      "endedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)

  // At most one live session per conversation. The routing predicate and the
  // worker both rely on "active" being unique, the same way the job queue relies
  // on auto_response_jobs_inflight_uniq.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_sessions_active_uniq
      ON questionnaire_sessions ("conversationId") WHERE status = 'active'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS questionnaire_sessions_agency_status_idx
      ON questionnaire_sessions ("agencyId", status)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS questionnaire_sessions_lead_idx
      ON questionnaire_sessions ("agencyId", "leadId")`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS questionnaire_sessions`)

  await knex.raw(`ALTER TABLE auto_response_jobs DROP CONSTRAINT IF EXISTS auto_response_jobs_reason_check`)
  await knex.raw(`ALTER TABLE auto_response_jobs
    ADD CONSTRAINT auto_response_jobs_reason_check
    CHECK (reason IN ('first_contact','qualify_turn','no_response_warning','no_response_close'))`)

  await knex.raw(`ALTER TABLE auto_response_settings DROP CONSTRAINT IF EXISTS auto_response_settings_responder_check`)
  const hasResponder = await knex.schema.hasColumn('auto_response_settings', 'responder')
  if (hasResponder) {
    await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN responder`)
  }
  const hasQuestionnaire = await knex.schema.hasColumn('auto_response_settings', 'questionnaire')
  if (hasQuestionnaire) {
    await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN questionnaire`)
  }
}
