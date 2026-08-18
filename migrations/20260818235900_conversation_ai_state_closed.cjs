/**
 * Additive: persist a real `closed` AI conversation state.
 * `dormant` stays inactive/resumable. `closed` means the interaction ended.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    DO $$
    DECLARE
      conname text;
    BEGIN
      SELECT c.conname INTO conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname = 'conversation_ai_state'
        AND n.nspname = 'public'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%aiState%'
      LIMIT 1;
      IF conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE conversation_ai_state DROP CONSTRAINT %I', conname);
      END IF;
    END $$
  `)
  await knex.raw(`
    ALTER TABLE conversation_ai_state
      ADD CONSTRAINT conversation_ai_state_aiState_check
      CHECK ("aiState" IN (
        'new',
        'ai_qualifying',
        'escalated',
        'dormant',
        'opted_out',
        'human_active',
        'closed'
      ))
  `)
}

exports.down = async function (knex) {
  await knex('conversation_ai_state').where({ aiState: 'closed' }).update({ aiState: 'ai_qualifying' })
  await knex.raw(`
    ALTER TABLE conversation_ai_state
      DROP CONSTRAINT IF EXISTS conversation_ai_state_aiState_check
  `)
  await knex.raw(`
    ALTER TABLE conversation_ai_state
      ADD CONSTRAINT conversation_ai_state_aiState_check
      CHECK ("aiState" IN (
        'new',
        'ai_qualifying',
        'escalated',
        'dormant',
        'opted_out',
        'human_active'
      ))
  `)
}
