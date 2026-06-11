/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  // Support/observability view: derived trial status per agency in plain SQL,
  // so "my trial is not working" is answered with one SELECT. The CASE
  // precedence MUST mirror lib/trial getTrialState() exactly
  // (PAID -> LEGACY -> NEVER_STARTED -> TRIAL_ACTIVE -> TRIAL_EXPIRED);
  // a cross-check verification pins the two derivations together.
  await knex.raw(`
    CREATE OR REPLACE VIEW _trial_status AS
    SELECT
      a.id   AS "agencyId",
      a.name AS "agencyName",
      a.plan,
      a."trialExempt",
      a."trialStartedAt",
      a."trialEndsAt",
      CASE
        WHEN a.plan = 'pro'              THEN 'PAID'
        WHEN a."trialExempt"             THEN 'LEGACY'
        WHEN a."trialStartedAt" IS NULL OR a."trialEndsAt" IS NULL THEN 'NEVER_STARTED'
        WHEN now() < a."trialEndsAt"     THEN 'TRIAL_ACTIVE'
        ELSE 'TRIAL_EXPIRED'
      END AS status,
      CASE
        WHEN a.plan = 'pro' OR a."trialExempt" OR a."trialStartedAt" IS NULL OR a."trialEndsAt" IS NULL THEN NULL
        ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a."trialEndsAt" - now())) / 86400))::int
      END AS "daysRemaining"
    FROM agencies a
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP VIEW IF EXISTS _trial_status`)
}
