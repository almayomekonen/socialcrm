/**
 * Facebook comments — tell the Page's own replies apart from incoming comments.
 *
 * WHY. The `feed` webhook delivers EVERY comment on a Page's posts, including
 * the ones the Page itself writes. Ingest never compared the author to the
 * Page, so a reply the business posted — from Facebook or, now, from inside
 * SocialCRM — landed as an `open` comment, raised a "new comment" alert, and
 * offered "צור ליד" for the business itself.
 *
 *  · "authorIsPage" — true when Meta's `from.id` is the Page id. Such rows are
 *    thread context (the business's replies), never work items and never
 *    leads.
 *  · "sentByUserId" — the SocialCRM user who replied from inside the app.
 *    NULL for replies written on Facebook directly.
 *
 * DEDUP. A reply sent from the app is recorded from the Graph response AND
 * arrives again on the `feed` webhook. Both carry the same comment id, so the
 * existing UNIQUE ("pageId", "commentId") keeps it to one row; the merge on
 * either path never clears "sentByUserId" (see lib/facebook/comments/replies.ts).
 *
 * ADDITIVE ONLY. Two nullable/defaulted columns and one index. No existing
 * column, constraint or index changes. The backfill writes only the new
 * column, from data already on the row.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('facebook_page_comments', 'authorIsPage'))) {
    await knex.raw(`
      ALTER TABLE facebook_page_comments
        ADD COLUMN "authorIsPage" boolean NOT NULL DEFAULT false
    `)
  }
  if (!(await knex.schema.hasColumn('facebook_page_comments', 'sentByUserId'))) {
    await knex.raw(`
      ALTER TABLE facebook_page_comments
        ADD COLUMN "sentByUserId" integer REFERENCES users(id) ON DELETE SET NULL
    `)
  }

  // Rows ingested before this column existed: the author id was already stored.
  await knex.raw(`
    UPDATE facebook_page_comments
       SET "authorIsPage" = true
     WHERE "authorIsPage" = false
       AND "authorExternalId" IS NOT NULL
       AND "authorExternalId" = "pageId"
  `)

  // FK lookups when a user is deleted (ON DELETE SET NULL scans otherwise).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS facebook_page_comments_sent_by_idx
      ON facebook_page_comments ("sentByUserId") WHERE "sentByUserId" IS NOT NULL
  `)

  // Thread read: replies under a set of comments on one Page.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS facebook_page_comments_page_parent_idx
      ON facebook_page_comments ("pageId", "parentId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS facebook_page_comments_page_parent_idx`)
  await knex.raw(`DROP INDEX IF EXISTS facebook_page_comments_sent_by_idx`)
  await knex.raw(`ALTER TABLE facebook_page_comments DROP COLUMN IF EXISTS "sentByUserId"`)
  await knex.raw(`ALTER TABLE facebook_page_comments DROP COLUMN IF EXISTS "authorIsPage"`)
}
