/**
 * seal_facebook_page_tokens.cjs — migrate existing PLAINTEXT Page access tokens
 * in facebook_pages to sealed storage (`scm1.` + AES-256-GCM, SECRETS_ENC_KEY).
 *
 *   node scripts/seal_facebook_page_tokens.cjs                 # dry run: counts only, writes nothing
 *   node scripts/seal_facebook_page_tokens.cjs --apply         # seal every plaintext row
 *   node scripts/seal_facebook_page_tokens.cjs --verify        # plaintext remaining + sealed rows that cannot be opened
 *
 * EMERGENCY ROLLBACK ONLY — before re-deploying a build older than the sealed-token
 * build (which cannot read sealed values):
 *   node scripts/seal_facebook_page_tokens.cjs --unseal                                   # dry run
 *   node scripts/seal_facebook_page_tokens.cjs --unseal --apply --confirm-writes-plaintext
 *
 *   ENV_FILE=.env.production.local node scripts/seal_facebook_page_tokens.cjs --verify
 *
 * PRECONDITION — ORDER MATTERS. Run --apply ONLY after the application build that
 * reads sealed tokens (resolvePageAccessToken) is live. The previous build reads
 * `page_access_token` as-is: a sealed value would be sent to Meta, fail with
 * error 190, and mark healthy Pages disconnected, stopping Lead Ads. The same
 * SECRETS_ENC_KEY the application uses must be in this script's environment.
 *
 * SAFETY
 *  · Each token is sealed, then opened again and compared, before it is written.
 *  · The write is compare-and-swap (`WHERE id = ? AND page_access_token = <read value>`):
 *    a row reconnected while the script runs is left alone and counted.
 *  · Idempotent: sealed rows are never touched; re-running reports 0 to seal.
 *
 * OUTPUT IS COUNTS AND ROW IDS ONLY. Never a token, never a Page id, never the
 * key, never the database URL. Exit code 1 if anything is left unsealed after
 * --apply, or if --verify finds a plaintext row or an unreadable seal.
 */
const ENV_FILE = process.env.ENV_FILE || '.env.local'
require('dotenv').config({ path: ENV_FILE, override: true })
const { PREFIX, encryptionKey, resolvePageToken, sealPageToken } = require('./resolvePageToken.cjs')

const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  },
  pool: { min: 0, max: 2 },
})

const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const unseal = process.argv.includes('--unseal')
const confirmPlaintext = process.argv.includes('--confirm-writes-plaintext')

async function counts() {
  const [row] = await knex('facebook_pages').select(
    knex.raw(`count(*)::int as total`),
    knex.raw(`count(*) filter (where page_access_token like ?)::int as sealed`, [`${PREFIX}%`]),
    knex.raw(`count(*) filter (where page_access_token not like ?)::int as plaintext`, [`${PREFIX}%`]),
  )
  return row
}

async function runVerify() {
  const before = await counts()
  let unreadable = 0
  const unreadableIds = []
  const sealedRows = await knex('facebook_pages').where('page_access_token', 'like', `${PREFIX}%`).select('id', 'page_access_token')
  for (const r of sealedRows) {
    try {
      if (!resolvePageToken(r.page_access_token)) throw new Error('empty')
    } catch {
      unreadable++
      unreadableIds.push(r.id)
    }
  }
  console.log(`facebook_pages total=${before.total} sealed=${before.sealed} plaintext=${before.plaintext} unreadable_seals=${unreadable}`)
  if (unreadableIds.length) console.log(`unreadable row ids: ${unreadableIds.join(',')}`)
  if (before.plaintext > 0 || unreadable > 0) process.exitCode = 1
}

async function runSeal() {
  const before = await counts()
  console.log(`mode=${apply ? 'apply' : 'dry-run'} facebook_pages total=${before.total} sealed=${before.sealed} plaintext=${before.plaintext}`)
  if (!apply) {
    console.log('dry run — nothing written. Re-run with --apply after the sealed-token build is live.')
    return
  }

  const rows = await knex('facebook_pages').whereNot('page_access_token', 'like', `${PREFIX}%`).select('id', 'page_access_token')
  let sealed = 0
  let changedConcurrently = 0
  const failedIds = []
  for (const r of rows) {
    try {
      const value = sealPageToken(r.page_access_token)
      if (resolvePageToken(value) !== String(r.page_access_token).trim()) throw new Error('round-trip mismatch')
      const n = await knex('facebook_pages').where({ id: r.id, page_access_token: r.page_access_token }).update({ page_access_token: value })
      if (Number(n) === 1) sealed++
      else changedConcurrently++
    } catch {
      failedIds.push(r.id)
    }
  }
  const after = await counts()
  console.log(`sealed=${sealed} changed_concurrently=${changedConcurrently} failed=${failedIds.length} plaintext_remaining=${after.plaintext}`)
  if (failedIds.length) console.log(`failed row ids: ${failedIds.join(',')}`)
  if (after.plaintext > 0 || failedIds.length > 0) process.exitCode = 1
}

/**
 * Reverse of --apply, for an emergency rollback to a build that reads tokens
 * as-is. Writes PLAINTEXT tokens back, so it demands an explicit confirmation
 * flag; the same compare-and-swap and counts-only output apply. Re-run --apply
 * once the sealed-token build is live again.
 */
async function runUnseal() {
  const before = await counts()
  console.log(`mode=${apply ? 'unseal-apply' : 'unseal-dry-run'} facebook_pages total=${before.total} sealed=${before.sealed} plaintext=${before.plaintext}`)
  if (!apply) {
    console.log('dry run — nothing written.')
    return
  }
  if (!confirmPlaintext) throw new Error('--unseal --apply writes plaintext tokens; add --confirm-writes-plaintext to proceed')
  const rows = await knex('facebook_pages').where('page_access_token', 'like', `${PREFIX}%`).select('id', 'page_access_token')
  let unsealed = 0
  let changedConcurrently = 0
  const failedIds = []
  for (const r of rows) {
    try {
      const plain = resolvePageToken(r.page_access_token)
      if (!plain) throw new Error('empty')
      const n = await knex('facebook_pages').where({ id: r.id, page_access_token: r.page_access_token }).update({ page_access_token: plain })
      if (Number(n) === 1) unsealed++
      else changedConcurrently++
    } catch {
      failedIds.push(r.id)
    }
  }
  const after = await counts()
  console.log(`unsealed=${unsealed} changed_concurrently=${changedConcurrently} failed=${failedIds.length} sealed_remaining=${after.sealed}`)
  if (failedIds.length) console.log(`failed row ids: ${failedIds.join(',')}`)
  if (after.sealed > 0 || failedIds.length > 0) process.exitCode = 1
}

async function main() {
  // Validate the key before reading a single token (presence/shape only — never printed).
  encryptionKey()
  if (verify) return runVerify()
  if (unseal) return runUnseal()
  return runSeal()
}

main()
  .catch((err) => {
    // Error messages here never include token material (see the helpers).
    console.error(`error: ${err && err.message ? err.message : 'unknown'}`)
    process.exitCode = 1
  })
  .finally(() => knex.destroy())
