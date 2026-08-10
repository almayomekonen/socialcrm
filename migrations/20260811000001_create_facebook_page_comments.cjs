/**
 * Facebook Page comments — MVP ingest table.
 *
 * ADDITIVE ONLY. No existing table, column, constraint or index is touched.
 *
 * WHY NOT REUSE inbox_conversations: that table requires `"leadId" NOT NULL
 * REFERENCES clients(id)`, and a comment exists BEFORE any Lead does — plus its
 * `channel` CHECK and `"businessPhoneNumberId"` / `"customerWaId"` NOT NULL
 * columns are WhatsApp-shaped. Reusing it would mean relaxing NOT NULL on a
 * live table carrying customer conversations. A separate table is lower risk.
 *
 * `"agencyId"` is denormalised from facebook_pages so every read is one indexed
 * tenant filter. It is written ONLY from the resolved Page connection, never
 * from the webhook payload — see lib/system/ingestFacebookComment.ts.
 *
 * `message` starts empty on every row: Meta withholds comment text without
 * `pages_read_user_content` (App Review pending). `"messageAvailable"` records
 * whether Meta actually sent it, so the UI can say "not available yet" rather
 * than implying the commenter wrote nothing. Verified in production
 * 2026-08-10: comment_id / post_id / from arrive; message does not.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS facebook_page_comments (
      id bigserial PRIMARY KEY,

      -- Tenancy. Resolved from facebook_pages via the SIGNED webhook page id.
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,

      -- Meta identity.
      "commentId" text NOT NULL,
      "postId" text NOT NULL,
      -- The parent OBJECT: the post for a top-level comment, a comment for a
      -- reply. Present on BOTH, so it is not a top-level discriminator on its
      -- own -- "isTopLevel" carries the computed parentId === postId answer.
      "parentId" text,
      "isTopLevel" boolean NOT NULL DEFAULT true,

      -- Author. A page-scoped id and a display name: no phone, no email. A Lead
      -- created from this is NOT directly callable.
      "authorExternalId" text,
      "authorName" text,

      -- Content. Empty until pages_read_user_content is granted.
      message text NOT NULL DEFAULT '',
      "messageAvailable" boolean NOT NULL DEFAULT false,

      -- Only live-comment verbs are persisted; 'remove' flips status instead.
      verb text NOT NULL DEFAULT 'add'
        CHECK (verb IN ('add','edited')),

      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','converted','ignored','deleted')),
      "convertedLeadId" integer REFERENCES clients(id) ON DELETE SET NULL,

      "createdTime" timestamptz,
      "receivedAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz
    )
  `)

  // Dedup key. Meta redelivers on any non-2xx, so duplicates are expected
  // traffic. Scoped to the PAGE rather than commentId alone: with a globally
  // unique key, a delivery naming page B could UPDATE a row owned by page A's
  // agency. Scoping to the page makes that cross-tenant write unrepresentable.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS facebook_page_comments_page_comment_uniq
      ON facebook_page_comments ("pageId", "commentId")
  `)

  // The one query the Comments Inbox runs: newest live comments for a tenant.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS facebook_page_comments_agency_status_idx
      ON facebook_page_comments ("agencyId", status, "createdTime" DESC)
  `)

  // Reverse lookup: which comment produced this Lead.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS facebook_page_comments_lead_idx
      ON facebook_page_comments ("convertedLeadId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS facebook_page_comments`)
}
