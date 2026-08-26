/**
 * Persist the Meta permissions actually granted for a connected Facebook Page.
 *
 * WHY. `hasCommentTextCapability(scopes)` was written so that the day Meta
 * approved `pages_read_user_content`, comment text would light up without a
 * rewrite — the gate reads granted scopes rather than a hardcoded flag. But
 * nothing ever persisted those scopes, so there was no source to read: the
 * OAuth callback inspected them, logged a derived count, and dropped them.
 *
 * Storing them makes three things possible that are otherwise guesswork:
 *   · the Comments UI can say "text is unavailable because this Page was
 *     connected before the permission existed" instead of implying the
 *     commenter wrote nothing;
 *   · the settings page can offer a RECONNECT, which is the only way an
 *     already-issued token can gain a scope — tokens never widen in place;
 *   · a future permission can be gated on real evidence rather than on a
 *     deploy date.
 *
 * SHAPE. `jsonb` array of permission NAMES, never asset ids and never a token.
 * Defaults to an empty array rather than NULL so every read is total and no
 * caller has to distinguish "no scopes" from "not recorded" — an existing row
 * that predates this column legitimately means "we do not know", and the empty
 * array is the fail-closed answer: capability false, reconnect offered.
 *
 * Additive and reversible. No behaviour changes on its own.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('facebook_pages', 'granted_scopes')
  if (!has) {
    await knex.raw(
      `ALTER TABLE facebook_pages ADD COLUMN granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb`,
    )
  }
}

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('facebook_pages', 'granted_scopes')
  if (has) await knex.raw(`ALTER TABLE facebook_pages DROP COLUMN granted_scopes`)
}
