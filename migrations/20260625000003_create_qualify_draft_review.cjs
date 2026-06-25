/**
 * AI Lead Qualifier — TEMPORARY draft-review store (P2.5 canary).
 *
 * While draft=true, the worker generates a turn but never sends it. Previously the
 * output existed only in ephemeral runtime logs. This table persists each draft turn
 * (reply, extracted fields, decision, escalation reason, summary, temperature) so the
 * canary output is reviewable. It is write-only observability — nothing reads from it
 * in the send path, so it can never affect customers. Drop it when the canary ends.
 *
 * Additive, reversible, ZERO behavior change.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS qualify_draft_review (
      id bigserial PRIMARY KEY,
      "conversationId" bigint NOT NULL,
      "agencyId" integer NOT NULL,
      decision text NOT NULL,                         -- 'send' | 'escalate'
      "escalationReason" text,                        -- hot_signal|uncertain|qualified|max_turns (null when decision='send')
      "replyText" text NOT NULL,                      -- the draft that WOULD have been sent (never sent)
      extracted jsonb NOT NULL DEFAULT '{}'::jsonb,   -- fields the AI pulled from this turn
      qualification jsonb NOT NULL DEFAULT '{}'::jsonb,-- accumulated qualification after merge
      "summaryText" text,                             -- internal handoff summary (escalation only)
      "suggestedAction" text,
      temperature text,                               -- hot|warm (escalation only)
      lang text,
      "turnCount" integer NOT NULL DEFAULT 0,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS qualify_draft_review_agency_created_idx
      ON qualify_draft_review ("agencyId", "createdAt" DESC)`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS qualify_draft_review`)
}
