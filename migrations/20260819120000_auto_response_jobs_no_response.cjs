/**
 * Additive: allow delayed no-response warning/close jobs on auto_response_jobs.
 * Does not change existing rows. Do not run until production rollout is approved.
 *
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
    CHECK (reason IN ('first_contact','qualify_turn','no_response_warning','no_response_close'))`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE auto_response_jobs DROP CONSTRAINT IF EXISTS auto_response_jobs_reason_check`)
  await knex.raw(`ALTER TABLE auto_response_jobs
    ADD CONSTRAINT auto_response_jobs_reason_check
    CHECK (reason IN ('first_contact','qualify_turn'))`)
}
