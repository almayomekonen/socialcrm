/**
 * Why an action ran without asking — recorded, not inferred.
 *
 * The approval decision stopped being `WRITE == APPROVAL` and became
 * RISK × INTENT: a low-risk write a rep explicitly commanded executes at once,
 * while the same action proposed by the agent on its own initiative waits. That
 * makes "who asked" a load-bearing input to an authorization decision, and an
 * authorization input that is not written down cannot be audited afterwards.
 *
 * NULLABLE, because rows written before this column existed genuinely do not
 * know — and a default of either value would invent an answer for them. New
 * rows always carry one; `lib/agent/actions/runtime.ts` fails closed to
 * AGENT_PROPOSAL when a caller omits it, so the absence of a value in a fresh
 * row is a bug, not a shrug.
 *
 * The third state the audit needs — "approval was required" — is already on the
 * row as `approvalState`, so it is not duplicated here.
 *
 * Additive and reversible. One column, no backfill, no existing table touched.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS intent text`)

  // The operational question this answers: how often does the agent act on its
  // own initiative versus on instruction, per tenant.
  await knex.raw(`CREATE INDEX IF NOT EXISTS agent_actions_intent_idx
      ON agent_actions ("agencyId", intent)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS agent_actions_intent_idx`)
  await knex.raw(`ALTER TABLE agent_actions DROP COLUMN IF EXISTS intent`)
}
