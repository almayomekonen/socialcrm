/**
 * Questionnaire Builder PR1: revision storage (Option B, approved 2026-10-06).
 * Additive, reversible. Design: docs/questionnaire-builder-pr1.md §2.3, §19.
 *
 * ONE TABLE, TWO KINDS OF ROW.
 *   status 'draft'     — the agency's single editable draft (at most one per
 *                        agency + channel, enforced by a partial unique index).
 *   status 'published' — an immutable revision. The row is born when its draft
 *                        is published and can never be updated or deleted again
 *                        (trigger below), so history is a database guarantee, not
 *                        a convention.
 *
 * THE RUNTIME DOES NOT READ THIS TABLE. It keeps reading
 * auto_response_settings.questionnaire, which the publish transaction updates
 * in the same transaction as the revision row. Rolling this migration back
 * therefore cannot affect a live conversation. Session pinning is untouched:
 * questionnaire_sessions keeps its own frozen copy of the definition.
 *
 * BACKFILL. Every settings row with a questionnaire becomes one published
 * revision, numbered from the definition's own `revision`, labelled
 * source = 'backfill', published at migration time with no publisher. No
 * earlier history is invented.
 *
 * PURGE. Published rows are immutable to everything except an explicit,
 * transaction-local purge (`SET LOCAL questionnaire.allow_purge = 'on'`), which
 * permits DELETE only — for deleting an agency or test cleanup. UPDATE of a
 * published row is never permitted.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS questionnaire_revisions (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      status text NOT NULL CHECK (status IN ('draft','published')),
      revision integer,
      definition jsonb NOT NULL,
      "draftVersion" integer NOT NULL DEFAULT 1,
      "baseRevision" integer,
      source text NOT NULL DEFAULT 'builder' CHECK (source IN ('builder','staff','backfill')),
      "createdBy" integer,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedBy" integer,
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "publishedBy" integer,
      "publishedAt" timestamptz,
      CONSTRAINT questionnaire_revisions_state_check CHECK (
        (status = 'draft' AND revision IS NULL AND "publishedAt" IS NULL)
        OR (status = 'published' AND revision IS NOT NULL AND revision >= 1 AND "publishedAt" IS NOT NULL)
      )
    )`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_revisions_revision_uniq
      ON questionnaire_revisions ("agencyId", channel, revision) WHERE revision IS NOT NULL`)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS questionnaire_revisions_one_draft_uniq
      ON questionnaire_revisions ("agencyId", channel) WHERE status = 'draft'`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS questionnaire_revisions_agency_status_idx
      ON questionnaire_revisions ("agencyId", channel, status)`)

  await knex.raw(`
    CREATE OR REPLACE FUNCTION questionnaire_revisions_immutable() RETURNS trigger AS $$
    BEGIN
      IF OLD.status = 'published' THEN
        IF TG_OP = 'DELETE' AND current_setting('questionnaire.allow_purge', true) = 'on' THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION 'questionnaire revision % of agency % is published and immutable', OLD.revision, OLD."agencyId"
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql`)
  await knex.raw(`DROP TRIGGER IF EXISTS questionnaire_revisions_immutable_trg ON questionnaire_revisions`)
  await knex.raw(`CREATE TRIGGER questionnaire_revisions_immutable_trg
      BEFORE UPDATE OR DELETE ON questionnaire_revisions
      FOR EACH ROW EXECUTE FUNCTION questionnaire_revisions_immutable()`)

  // Backfill the current published definitions. Idempotent: a row already
  // backfilled for the same agency + revision is skipped.
  await knex.raw(`
    INSERT INTO questionnaire_revisions
      ("agencyId", channel, status, revision, definition, source, "publishedAt", "createdAt", "updatedAt")
    SELECT s."agencyId", s.channel, 'published', (s.questionnaire->>'revision')::int, s.questionnaire,
           'backfill', now(), now(), now()
      FROM auto_response_settings s
     WHERE s.questionnaire IS NOT NULL
       AND jsonb_typeof(s.questionnaire) = 'object'
       AND (s.questionnaire->>'revision') ~ '^[1-9][0-9]*$'
       AND NOT EXISTS (
         SELECT 1 FROM questionnaire_revisions r
          WHERE r."agencyId" = s."agencyId" AND r.channel = s.channel
            AND r.revision = (s.questionnaire->>'revision')::int
       )`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS questionnaire_revisions`)
  await knex.raw(`DROP FUNCTION IF EXISTS questionnaire_revisions_immutable()`)
}
