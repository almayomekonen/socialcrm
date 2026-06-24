/**
 * AI Lead Qualifier — P0b (database preparation only). Additive, reversible,
 * ZERO behavior change for any agency.
 *
 *   conversation_ai_state : per-conversation AI lifecycle + collected qualification.
 *   auto_response_settings: + mode/maxTurns/collectFields/draft. Every default
 *     reproduces today's one-shot "acknowledge" behavior, so existing agencies
 *     are untouched until an agency is explicitly switched to mode='qualify'.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conversation_ai_state (
      "conversationId" bigint PRIMARY KEY REFERENCES inbox_conversations(id) ON DELETE CASCADE,
      "agencyId" integer NOT NULL,
      "aiState" text NOT NULL DEFAULT 'new'
        CHECK ("aiState" IN ('new','ai_qualifying','escalated','dormant','opted_out','human_active')),
      "aiTurnCount" integer NOT NULL DEFAULT 0,
      "aiLastAt" timestamptz,
      qualification jsonb NOT NULL DEFAULT '{}'::jsonb,
      "escalatedAt" timestamptz,
      "escalationReason" text,
      "stoppedReason" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS conversation_ai_state_agency_state_idx
      ON conversation_ai_state ("agencyId", "aiState")`)

  // Additive columns on auto_response_settings — defaults preserve acknowledge mode.
  const add = async (col, ddl) => {
    const has = await knex.schema.hasColumn('auto_response_settings', col)
    if (!has) await knex.raw(`ALTER TABLE auto_response_settings ADD COLUMN ${ddl}`)
  }
  await add('mode', `mode text NOT NULL DEFAULT 'acknowledge' CHECK (mode IN ('acknowledge','qualify'))`)
  await add('maxTurns', `"maxTurns" integer NOT NULL DEFAULT 5`)
  await add(
    'collectFields',
    `"collectFields" jsonb NOT NULL DEFAULT '{"required":["name","need","urgency"],"optional":["budget","location","callback"]}'::jsonb`,
  )
  await add('draft', `draft boolean NOT NULL DEFAULT false`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  for (const col of ['mode', 'maxTurns', 'collectFields', 'draft']) {
    const has = await knex.schema.hasColumn('auto_response_settings', col)
    if (has) await knex.raw(`ALTER TABLE auto_response_settings DROP COLUMN "${col}"`)
  }
  await knex.raw(`DROP TABLE IF EXISTS conversation_ai_state`)
}
