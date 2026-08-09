/**
 * `quote.create` — the fourth automation action, and its persisted value.
 *
 * Widens `automation_definitions.action` to admit `create_quote`, exactly as
 * 20260809000001 widened it to admit `create_task` and `send_whatsapp`. The
 * conformance suite pins catalog ↔ bridge ↔ ACTION_TYPES totality in both
 * directions, so this migration and that vocabulary can no longer drift apart
 * silently — which is the whole reason the earlier widening existed.
 *
 * Doctrine:
 *   - Additive. The new list is a strict SUPERSET, so no existing row can fail
 *     it and no row is rewritten. The DEFAULT stays 'send_email'.
 *   - `action` exists on automation_definitions ONLY; nothing else is touched.
 *   - Values are PERSISTED, APPEND-ONLY vocabulary (ADR-008). `create_quote`
 *     follows the verb_noun form of its three siblings and is never renamed.
 *   - Reversible, but REFUSES rather than destroys (the 20260803000005
 *     precedent): narrowing once a row uses the value would fail mid-statement,
 *     so it says why first.
 *
 * @param {import('knex').Knex} knex
 */

const WIDENED = `'send_email','create_task','send_whatsapp','create_quote'`
const PREVIOUS = `'send_email','create_task','send_whatsapp'`

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_action_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_action_check
      CHECK (action IN (${WIDENED}));
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const [{ count }] = await knex('automation_definitions').count({ count: '*' }).where('action', 'create_quote')

  if (Number(count) > 0) {
    throw new Error(
      `[quote action down] refusing: ${count} automation definition(s) run quote.create. ` +
        'Re-point or delete them first — narrowing the CHECK would fail against real rows.',
    )
  }

  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_action_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_action_check
      CHECK (action IN (${PREVIOUS}));
  `)
}
