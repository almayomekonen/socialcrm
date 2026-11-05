/**
 * Retire AWS bucket URLs from the database: storage moved to Cloudflare R2.
 *
 * 1. `files.url` is a GENERATED column whose expression hardcodes an AWS bucket.
 *    It now points at the app's authenticated route, /api/files/<id>, so a file's
 *    URL no longer names any storage provider and every read passes the access
 *    checks. It is derived data: dropping and re-adding it loses nothing, and no
 *    other column changes. The previous expression is saved as a column comment so
 *    that down() restores what this database actually had, whatever that was.
 *
 *    Holds an ACCESS EXCLUSIVE lock while `files` is rewritten, inside knex's migration
 *    transaction, so a failure leaves everything as it was. `lock_timeout` makes it give
 *    up and fail rather than queue every request behind a long-running query; just run
 *    it again. Fails loudly, by design, if a view depends on the column.
 *
 * 2. Rendered invoice PDFs pointing at AWS are no longer retrievable, by product
 *    decision (2026-11-05). They are marked `failed` with an explicit reason, which
 *    is what the invoice screen's existing "render again" button acts on. Legal
 *    invoice rows are not touched, and no row is deleted.
 *
 * `files` rows from before this migration stay listed; their `path` has no
 * `tenants/` prefix, so /api/files/<id> answers 410 for them.
 *
 * @param {import('knex').Knex} knex
 */

const LEGACY_REASON = 'legacy_storage_retired'
const ABANDONED_REASON = 'legacy_render_abandoned'
const PREVIOUS_MARKER = 'previous_expression:'
const LOCK_TIMEOUT = `SET LOCAL lock_timeout = '5s'`

async function currentExpression(knex) {
  const { rows } = await knex.raw(`
    SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.files'::regclass AND a.attname = 'url' AND a.attgenerated = 's'
  `)
  return rows[0]?.expression ?? null
}

exports.up = async function (knex) {
  await knex.raw(LOCK_TIMEOUT)
  const previous = await currentExpression(knex)

  await knex.raw(`ALTER TABLE files DROP COLUMN IF EXISTS url`)
  await knex.raw(`
    ALTER TABLE files ADD COLUMN url character varying(255)
      GENERATED ALWAYS AS ('/api/files/'::text || id::text) STORED
  `)
  if (previous) {
    await knex.raw(`COMMENT ON COLUMN files.url IS ${knex.raw('?', [PREVIOUS_MARKER + previous]).toQuery()}`)
  }

  // No longer current, or the status poller would keep reading this row after a
  // re-render starts. Older non-current renders are history nobody reads, and stay.
  const aws = () => knex('bill_documents').where('url', 'like', 'https://%.amazonaws.com/%')
  await aws().where({ status: 'ready', isCurrent: true }).update({ status: 'failed', isCurrent: false, errorReason: LEGACY_REASON })
  await aws().where({ status: 'rendering' }).update({ status: 'failed', errorReason: ABANDONED_REASON })
}

exports.down = async function (knex) {
  await knex.raw(LOCK_TIMEOUT)
  const { rows } = await knex.raw(`SELECT col_description('public.files'::regclass, a.attnum) AS comment
    FROM pg_attribute a WHERE a.attrelid = 'public.files'::regclass AND a.attname = 'url'`)
  const comment = rows[0]?.comment ?? ''
  if (!comment.startsWith(PREVIOUS_MARKER)) {
    throw new Error('[files_url_app_route down] refusing: the previous files.url expression was not recorded.')
  }
  const previous = comment.slice(PREVIOUS_MARKER.length)

  await knex.raw(`ALTER TABLE files DROP COLUMN url`)
  await knex.raw(`ALTER TABLE files ADD COLUMN url character varying(255) GENERATED ALWAYS AS (${previous}) STORED`)

  await knex('bill_documents').where({ status: 'failed', errorReason: ABANDONED_REASON }).update({ status: 'rendering', errorReason: null })
  // Only where no newer render became current since: one current document per invoice.
  await knex('bill_documents as d')
    .where({ 'd.status': 'failed', 'd.errorReason': LEGACY_REASON })
    .whereNotExists(knex('bill_documents as c').whereRaw('c."invoiceId" = d."invoiceId"').where('c.isCurrent', true))
    .update({ status: 'ready', isCurrent: true, errorReason: null })
}
