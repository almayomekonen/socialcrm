/**
 * ChatGPT / MCP (Phase A) — one row per MCP tool call.
 *
 * Reads are recorded in Phase A, writes in Phase B. The same rows are the
 * source of truth for MCP rate limiting (the repo's DB-count pattern), hence the
 * (grant_id, occurred_at) index.
 *
 * params is SANITISED before insert (lib/mcp/audit.ts): ids, enums, limits and
 * booleans only; any free text is stored as {len}. No message content, no
 * tokens, no names.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable('mcp_audit_events')) return

  await knex.schema.createTable('mcp_audit_events', (t) => {
    t.bigIncrements('id').primary()
    // Correlation id, also returned to the client in tool errors.
    t.uuid('request_id').notNullable()
    t.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.integer('agency_id').notNullable()
    t.integer('user_id').notNullable()
    t.bigInteger('grant_id').notNullable().references('id').inTable('oauth_grants').onDelete('CASCADE')
    t.text('client_id').notNullable()
    // Derived from client_id on the server, never from tool input.
    t.string('source', 16).notNullable().defaultTo('chatgpt')
    t.string('tool', 64).notNullable()
    t.string('kind', 8).notNullable()
    t.string('target_type', 16)
    t.bigInteger('target_id')
    t.jsonb('params').notNullable().defaultTo('{}')
    t.string('outcome', 24).notNullable()
    t.integer('result_count')
    t.integer('duration_ms')

    t.index(['grant_id', 'occurred_at'], 'mcp_audit_grant_time_idx')
    t.index(['agency_id', 'occurred_at'], 'mcp_audit_agency_time_idx')
    t.index(['occurred_at'], 'mcp_audit_time_idx')
  })

  await knex.raw("ALTER TABLE mcp_audit_events ADD CONSTRAINT mcp_audit_events_kind_check CHECK (kind IN ('read', 'write'))")
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mcp_audit_events')
}
