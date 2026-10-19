/**
 * SocialCRM AI over WhatsApp, meetings: the single-use confirmation behind a
 * WhatsApp "approve / cancel" button.
 *
 * One row per confirmation card. It binds an opaque token (the button payload)
 * to ONE recipient and ONE pending agent action (`actionId` + `argsHash`, the
 * exact arguments the owner was shown), with an expiry. A decision is a guarded
 * transition out of `pending`, so a replayed, expired or superseded button can
 * never approve anything. The action itself lives in `agent_actions` and runs
 * through the existing Action Runtime; nothing here executes.
 *
 * Also widens `wa_assistant_jobs.kind` with `decision` (a button reply).
 *
 * ADDITIVE: one new table; one CHECK constraint widened. No foreign key.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS wa_assistant_approvals (
      id bigserial PRIMARY KEY,
      token text NOT NULL,
      "recipientId" bigint NOT NULL,
      "agencyId" integer NOT NULL,
      "userId" integer NOT NULL,
      "jobId" bigint NOT NULL,
      "actionId" text NOT NULL,
      "argsHash" text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','superseded')),
      "expiresAt" timestamptz NOT NULL,
      "decidedAt" timestamptz NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS wa_assistant_approvals_token_uniq ON wa_assistant_approvals (token)`)
  await knex.raw(`CREATE INDEX IF NOT EXISTS wa_assistant_approvals_pending_idx ON wa_assistant_approvals ("recipientId") WHERE status = 'pending'`)
  await knex.raw(`ALTER TABLE wa_assistant_jobs DROP CONSTRAINT IF EXISTS wa_assistant_jobs_kind_check`)
  await knex.raw(`ALTER TABLE wa_assistant_jobs ADD CONSTRAINT wa_assistant_jobs_kind_check CHECK (kind IN ('text','unsupported','decision'))`)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DELETE FROM wa_assistant_jobs WHERE kind = 'decision'`)
  await knex.raw(`ALTER TABLE wa_assistant_jobs DROP CONSTRAINT IF EXISTS wa_assistant_jobs_kind_check`)
  await knex.raw(`ALTER TABLE wa_assistant_jobs ADD CONSTRAINT wa_assistant_jobs_kind_check CHECK (kind IN ('text','unsupported'))`)
  await knex.raw(`DROP TABLE IF EXISTS wa_assistant_approvals`)
}
