/**
 * Admit `conversation` as a signal SUBJECT — detection only.
 *
 * WHY. A leadless WhatsApp Contact conversation can raise an objection or go
 * quiet mid-deal, and the qualifier already classifies both. Wave 1 could not
 * turn either into a signal: `subjectType` was `CHECK (... IN ('lead',
 * 'portfolio'))`, a Contact has no Lead, and `portfolio` means the whole agency
 * — so the readers filtered Contacts out rather than fabricating a subject.
 *
 * TWO TABLES, AND DELIBERATELY ONLY TWO. A signal's life has two halves, and
 * this migration widens exactly the half that OBSERVES:
 *
 *   · `signal_jobs`         — the observation is queued
 *   · `ai_shadow_coverage`  — the observation's processing outcome is recorded
 *
 * `ai_spend_reservations`, `ai_investigations`, `ai_beliefs` and `ai_insights`
 * are left untouched ON PURPOSE. They belong to the half that INVESTIGATES, and
 * a Contact is not an investigable subject in this phase: it has no handler, so
 * `resolveAutonomousScope` could not name a responsible person without inventing
 * one. Their unchanged CHECKs are therefore not an oversight — they are the
 * enforcement. If a future change ever routed a conversation subject into that
 * half, the database would refuse the write rather than let it proceed against a
 * fabricated owner.
 *
 * THE DECLINE IS ALREADY BUILT. `checkPreconditions` opens with
 * `if (job.subjectType !== 'lead') return { proceed: false, … }`, positioned
 * BEFORE the P3 reservation lookup — so a Contact signal is declined without
 * reserving spend, without an investigation row, and without an insight. This
 * migration adds no new rejection path; it lets an existing one do its job on a
 * subject that previously could not exist.
 *
 * SAFETY. Purely additive: each CHECK is replaced by a strictly wider one, so
 * every row that validated before still validates. No historical row is read,
 * rewritten or migrated, and no column is renamed, dropped or retyped. The down
 * migration restores the exact original predicate, which is safe precisely
 * because nothing has widened the DATA — a `conversation` row could only exist
 * if this migration had run, and reverting is a decision to discard those
 * observations, not a silent corruption of older ones.
 *
 * @param {import('knex').Knex} knex
 */

/** The two tables that record an OBSERVATION. Never the investigation tables. */
const OBSERVATION_TABLES = ['signal_jobs', 'ai_shadow_coverage']

/**
 * Swap the subjectType CHECK on one table.
 *
 * THE NAME IS LOOKED UP, NEVER ASSUMED. These constraints were created inline
 * (`"subjectType" text NOT NULL CHECK (…)`), so Postgres generated their names.
 * Guessing `{table}_subjectType_check` and being wrong would be the worst
 * possible outcome: `DROP … IF EXISTS` would silently match nothing, the ADD
 * would append a SECOND check beside the original, and the migration would
 * report success while the old narrow predicate kept rejecting `conversation`.
 *
 * So the definition is found in `pg_constraint` — the same technique
 * `migrations/20260819120000_auto_response_jobs_no_response.cjs` already uses
 * on this codebase — and every matching CHECK is dropped before the intended
 * one is added. Re-running is a no-op in both directions.
 */
async function setSubjectTypeCheck(knex, table, values) {
  const list = values.map((v) => `'${v}'`).join(',')
  const name = `${table}_subjectType_check`
  await knex.raw(
    `
    DO $$
    DECLARE cn text;
    BEGIN
      FOR cn IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = '${table}'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%subjectType%'
      LOOP
        EXECUTE 'ALTER TABLE ${table} DROP CONSTRAINT ' || quote_ident(cn);
      END LOOP;
      ALTER TABLE ${table}
        ADD CONSTRAINT "${name}"
        CHECK ("subjectType" IN (${list}));
    END $$`,
  )
}

exports.up = async function (knex) {
  for (const table of OBSERVATION_TABLES) {
    await setSubjectTypeCheck(knex, table, ['lead', 'conversation', 'portfolio'])
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const table of OBSERVATION_TABLES) {
    await setSubjectTypeCheck(knex, table, ['lead', 'portfolio'])
  }
}
