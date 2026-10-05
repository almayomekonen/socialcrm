/**
 * Facebook comments — context for the comments inbox.
 *
 * WHY NOW. Meta approved `pages_read_user_content`, so comment text arrives on
 * the `feed` webhook. What a rep still cannot see is WHO wrote it (a picture)
 * and WHAT it was written on (the post). This stores both, so the inbox reads
 * them from the database instead of calling Graph once per rendered card.
 *
 * facebook_page_comments, five nullable columns:
 *  · "attachmentType" / "attachmentUrl" — a photo or video the commenter
 *    attached. Delivered on the webhook itself (`photo` / `video`); no Graph call.
 *  · "authorPictureUrl" / "authorPictureStatus" / "authorPictureFetchedAt" —
 *    the commenter's picture from GET /{page-scoped-id}/picture (Page token).
 *    Meta's CDN URLs expire, so the fetch time is kept for a refresh. Status
 *    'none' means Meta answered with its generic silhouette — recorded so it is
 *    not asked again every render; 'denied' means Meta refused.
 *
 * facebook_page_posts, new — one row per (agency, Page, post), shared by every
 * comment on that post: one Graph call per POST, never per comment. The
 * permalink and status_type come free on the webhook; message / full_picture
 * come from GET /{post-id} (Page token). "fetchStatus" 'unavailable' records a
 * post Meta says is gone, so the card can say so instead of failing quietly.
 *
 * TENANCY. "agencyId" is part of the post key, exactly like messenger_conversations:
 * a Page reconnected by another agency starts with fresh rows, and every read
 * filters on it. Written only from the Page resolved via the signed webhook or
 * from the agency's own Page token.
 *
 * ADDITIVE ONLY. Nullable columns and a new table. Existing rows are untouched
 * and keep rendering — the UI treats every new field as optional.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const addColumn = async (name, ddl) => {
    if (!(await knex.schema.hasColumn('facebook_page_comments', name))) {
      await knex.raw(`ALTER TABLE facebook_page_comments ADD COLUMN ${ddl}`)
    }
  }
  await addColumn('attachmentType', `"attachmentType" text CHECK ("attachmentType" IN ('photo','video'))`)
  await addColumn('attachmentUrl', `"attachmentUrl" text`)
  await addColumn('authorPictureUrl', `"authorPictureUrl" text`)
  await addColumn(
    'authorPictureStatus',
    `"authorPictureStatus" text CHECK ("authorPictureStatus" IN ('ok','none','denied'))`,
  )
  await addColumn('authorPictureFetchedAt', `"authorPictureFetchedAt" timestamptz`)

  // Enrichment finds the rows of one commenter on one Page.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS facebook_page_comments_page_author_idx
      ON facebook_page_comments ("pageId", "authorExternalId")
  `)

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS facebook_page_posts (
      id bigserial PRIMARY KEY,
      "agencyId" integer NOT NULL,
      "pageId" varchar(64) NOT NULL,
      "postId" text NOT NULL,
      message text,
      "pictureUrl" text,
      "permalinkUrl" text,
      "statusType" text,
      "createdTime" timestamptz,
      "fetchStatus" text CHECK ("fetchStatus" IN ('ok','unavailable','denied')),
      "fetchedAt" timestamptz,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS facebook_page_posts_agency_page_post_uniq
      ON facebook_page_posts ("agencyId", "pageId", "postId")
  `)
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS facebook_page_posts`)
  await knex.raw(`DROP INDEX IF EXISTS facebook_page_comments_page_author_idx`)
  for (const col of ['authorPictureFetchedAt', 'authorPictureStatus', 'authorPictureUrl', 'attachmentUrl', 'attachmentType']) {
    await knex.raw(`ALTER TABLE facebook_page_comments DROP COLUMN IF EXISTS "${col}"`)
  }
}
