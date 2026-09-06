/**
 * Agent action approvals — a human's authorisation, made durable.
 *
 * WHY A SEPARATE TABLE FROM `agent_actions`. An approval is an EVENT with its
 * own actor and its own moment, and there can be more than one per action: a
 * rejection arriving beside an approval is the case the runtime already has
 * semantics for (rejection dominates), and a single `approvedBy` column on the
 * action row cannot represent it. A future plan-level grant covers several
 * actions from one decision, which a column on one row cannot express either.
 *
 * WHAT MAKES A GRANT UNFORGEABLE is `argsHash`. Binding only to `actionId` would
 * let an action be approved and then edited — same id, different due date, same
 * "yes". The hash is of the exact arguments the human was shown, so changing any
 * of them silently voids the approval rather than silently inheriting it. It is
 * also what stops one approval being spent on an unrelated action.
 *
 * EXPIRY IS STORED PER GRANT, not configured globally, because the window that
 * is reasonable for one kind of action is not reasonable for another, and an
 * approval acted on an hour later is a different decision from the one that was
 * made. `expiresAt` is written once at decision time and never recomputed, so
 * the deadline cannot drift with a redeploy or a clock change.
 *
 * NOTHING IS DELETED. A rejection is a row, not the absence of one; a revoked
 * approval would be a new REJECTED row rather than an UPDATE, so the audit trail
 * shows what was decided and when, not merely what the current answer is.
 *
 * Additive and reversible. No existing table is touched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS agent_action_approvals (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,                  -- authenticated scope, never a model value
      "actionId" text,                              -- the exact action, when the grant names one
      "planId" text,                                -- or the plan, when it covers a batch
      "argsHash" text NOT NULL,                     -- the arguments the human actually saw
      decision text NOT NULL,                       -- 'APPROVED' | 'REJECTED'
      "decidedByUserId" integer NOT NULL,           -- the approver; never the model, never the agent
      "decidedAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL,             -- written once, never recomputed
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT agent_action_approvals_target_chk CHECK ("actionId" IS NOT NULL OR "planId" IS NOT NULL),
      CONSTRAINT agent_action_approvals_decision_chk CHECK (decision IN ('APPROVED', 'REJECTED'))
    )`)

  // The lookup the runtime performs before every approval-required action.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_action_approvals_action_idx
      ON agent_action_approvals ("agencyId", "actionId")`)

  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_action_approvals_plan_idx
      ON agent_action_approvals ("agencyId", "planId")`)

  /**
   * One decision per approver per action: a double-click is not two approvals.
   *
   * NOT a partial index, deliberately. `WHERE "actionId" IS NOT NULL` reads like
   * the right restriction and breaks the only statement that uses it: Postgres
   * will not match a partial index in `ON CONFLICT (...)` unless the statement
   * repeats the predicate, so the insert fails outright with "no unique or
   * exclusion constraint matching". The predicate is also unnecessary — NULL is
   * never equal to NULL in a unique index, so plan-only grants (`actionId` NULL)
   * already never collide with each other.
   */
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS agent_action_approvals_once_uniq
      ON agent_action_approvals ("agencyId", "actionId", "decidedByUserId", decision)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS agent_action_approvals`)
}
