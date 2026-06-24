/**
 * AI Lead Qualifier — T1. Additive, reversible. Allows auto_response_jobs.reason
 * to be 'qualify_turn' in addition to 'first_contact'. No rows change; acknowledge
 * mode keeps enqueuing 'first_contact' exactly as before.
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
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
    CHECK (reason IN ('first_contact','qualify_turn'))`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE auto_response_jobs DROP CONSTRAINT IF EXISTS auto_response_jobs_reason_check`)
  await knex.raw(`ALTER TABLE auto_response_jobs
    ADD CONSTRAINT auto_response_jobs_reason_check CHECK (reason IN ('first_contact'))`)
}
