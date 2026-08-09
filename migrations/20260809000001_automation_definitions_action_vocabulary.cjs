/**
 * Phase A — widen the engine's persisted ACTION vocabulary.
 *
 * `automation_definitions.action` was created in the engine's first migration as
 *
 *     action text NOT NULL DEFAULT 'send_email' CHECK (action IN ('send_email'))
 *
 * and was never widened, while the sibling `trigger` check was widened twice
 * (20260803000004, 20260803000005). Two further actions have since shipped —
 * `task.create` (B6b) and `whatsapp.send` — each with a catalog entry, an
 * executor, a law set, a preview and CI conformance coverage. Neither can be
 * SAVED:
 *
 *   createDefinition() writes `engineActionForActionKey(actionKey)`, which
 *   resolves only 'email.send' and returns null for anything else. knex binds
 *   that null explicitly rather than omitting the column, so the insert fails
 *   the NOT NULL constraint (23502) — and even a non-null value would fail the
 *   CHECK.
 *
 * The user-visible symptom is the shipped marketplace template
 * `internal_task_on_new_lead` ("משימה לנציג על כל ליד חדש"), which cannot be
 * installed at all.
 *
 * This migration widens the CHECK to the three actions the executor registry
 * actually implements. The companion change in lib/automations/catalog/
 * engineBridge.ts adds the two missing key mappings; a conformance test now
 * pins catalog ↔ bridge totality in both directions so a fourth action cannot
 * repeat this.
 *
 * Doctrine:
 *   - Additive only. The new list is a strict SUPERSET of the old one, so no
 *     existing row can fail it and no row is rewritten.
 *   - No column renamed, retyped, dropped or defaulted differently. The DEFAULT
 *     stays 'send_email' — every legacy row and every row written through the
 *     legacy path keeps behaving exactly as it did.
 *   - Values are PERSISTED, APPEND-ONLY vocabulary (ADR-008). 'create_task' and
 *     'send_whatsapp' follow the existing verb_noun form of 'send_email'; they
 *     are never renamed once written.
 *   - `action` exists on automation_definitions ONLY. automation_jobs and
 *     automation_activity carry trigger/origin, never action, so nothing else
 *     is touched.
 *   - Reversible, but REFUSES rather than destroys — the 20260803000005
 *     precedent. Narrowing the CHECK once a row uses a new value would fail
 *     mid-statement; refusing first says why.
 *
 * @param {import('knex').Knex} knex
 */

const WIDENED = `'send_email','create_task','send_whatsapp'`
const ORIGINAL = `'send_email'`

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_action_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_action_check
      CHECK (action IN (${WIDENED}));
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const [{ count }] = await knex('automation_definitions')
    .count({ count: '*' })
    .whereIn('action', ['create_task', 'send_whatsapp'])

  if (Number(count) > 0) {
    throw new Error(
      `[Phase A down] refusing: ${count} automation definition(s) use an action this migration added. ` +
        'Re-point or delete them first — narrowing the CHECK would fail against real rows.',
    )
  }

  await knex.raw(`
    ALTER TABLE automation_definitions DROP CONSTRAINT IF EXISTS automation_definitions_action_check;
    ALTER TABLE automation_definitions ADD CONSTRAINT automation_definitions_action_check
      CHECK (action IN (${ORIGINAL}));
  `)
}
