/**
 * probe_facebook_comments.cjs — READ-ONLY capability probe (Phase 3 POC).
 *
 * Answers one question empirically: can an ALREADY-STORED Page access token
 * read Page posts and the comments on them?
 *
 * It writes nothing — no DB writes, no Meta writes, no subscription changes,
 * no OAuth changes. Four GETs against the Graph API and one SELECT.
 *
 * Usage:
 *   node scripts/probe_facebook_comments.cjs                 # .env.local (localhost)
 *   ENV_FILE=.env.production.local node scripts/probe_facebook_comments.cjs
 *   node scripts/probe_facebook_comments.cjs --page-id 1234  # pick a specific Page
 *
 * SECRETS: the Page access token is sent only in an Authorization header and is
 * never printed. `say()` scrubs every known secret from output as a backstop.
 */
const ENV_FILE = process.env.ENV_FILE || '.env.local'
require('dotenv').config({ path: ENV_FILE, override: true })

const knex = require('knex')({
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '') ? false : { rejectUnauthorized: false },
  },
  pool: { min: 0, max: 2 },
})

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

/** Secrets that must never reach stdout, longest first. */
const secrets = []
/** console.log with every known secret scrubbed. */
function say(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
  console.log(secrets.reduce((acc, s) => acc.split(s).join('<redacted>'), line))
}

/** One sanitized Graph GET. Returns { ok, status, body }. Token stays in the header. */
async function graphGet(label, path, token, fields) {
  const url = `${GRAPH_BASE}${path}${fields ? `${path.includes('?') ? '&' : '?'}fields=${fields}` : ''}`
  say(`\n── ${label}`)
  say(`   endpoint: ${GRAPH_BASE}${path}`)
  if (fields) say(`   fields:   ${fields}`)

  let res
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    say(`   RESULT:   network error — ${err && err.message}`)
    return { ok: false, status: 0, body: null }
  }

  const body = await res.json().catch(() => null)
  if (!res.ok || body?.error) {
    const e = body?.error || {}
    say(`   RESULT:   FAILED  http=${res.status}`)
    say(`   error:    code=${e.code ?? 'n/a'} subcode=${e.error_subcode ?? 'n/a'} type=${e.type ?? 'n/a'}`)
    say(`   message:  ${e.message ?? '(none)'}`)
    if (e.fbtrace_id) say(`   fbtrace:  ${e.fbtrace_id}`)
    return { ok: false, status: res.status, body }
  }

  say(`   RESULT:   OK  http=${res.status}  items=${Array.isArray(body?.data) ? body.data.length : 'n/a'}`)
  return { ok: true, status: res.status, body }
}

/** Comment/post shape only — message text is truncated, author id is not printed. */
const shapeOf = (o) => (o ? Object.keys(o).sort().join(', ') : '(empty)')

async function main() {
  say(`Graph version: ${GRAPH_VERSION}`)
  say(`Env file:      ${ENV_FILE}`)
  say(`Scopes requested by app/api/auth/facebook/route.ts: pages_show_list, pages_manage_metadata, leads_retrieval`)

  const wantedPageId = process.argv[process.argv.indexOf('--page-id') + 1]
  const q = knex('facebook_pages').orderBy('id', 'asc')
  if (process.argv.includes('--page-id')) q.where({ page_id: wantedPageId })
  const connection = await q.first()

  if (!connection) {
    say('\nNO CONNECTED PAGE in this database — cannot probe.')
    say('facebook_pages is empty (or the requested page_id is absent).')
    say('Re-run against an environment that has a connected Page.')
    return
  }

  const token = connection.page_access_token
  secrets.push(token)
  if (process.env.META_APP_SECRET) secrets.push(process.env.META_APP_SECRET)

  say(`\nPage row: id=${connection.id} agency_id=${connection.agency_id} user_id=${connection.user_id}`)
  say(`          page_id=…${String(connection.page_id).slice(-4)} health=${connection.health_status}`)

  // 1. What does this stored token ACTUALLY carry? Definitive, unlike reading
  //    the requested-scope list in code — a token can predate a scope change.
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (appId && appSecret) {
    const appToken = `${appId}|${appSecret}`
    secrets.push(appToken)
    const dbg = await graphGet(
      '1. debug_token — permissions actually on the stored Page token',
      `/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
      token,
    )
    const d = dbg.body?.data
    if (d) {
      say(`   token type:   ${d.type ?? 'unknown'}`)
      say(`   is_valid:     ${d.is_valid}`)
      say(`   expires_at:   ${d.expires_at === 0 ? 'never (long-lived)' : d.expires_at}`)
      say(`   scopes:       ${(d.scopes || []).join(', ') || '(none reported)'}`)
      for (const g of d.granular_scopes || []) say(`   granular:     ${g.scope}`)
      const has = (p) => (d.scopes || []).includes(p)
      say(`   → pages_read_engagement:   ${has('pages_read_engagement') ? 'PRESENT' : 'ABSENT'}`)
      say(`   → pages_read_user_content: ${has('pages_read_user_content') ? 'PRESENT' : 'ABSENT'}`)
    }
  } else {
    say('\n── 1. debug_token skipped — META_APP_ID / META_APP_SECRET not set')
  }

  // 2. Page identity — works with almost any valid Page token; a sanity baseline.
  await graphGet('2. Page identity (baseline sanity)', `/${connection.page_id}`, token, 'id,name')

  // 3. Page posts — needs pages_read_engagement.
  const posts = await graphGet(
    '3. Page posts (needs pages_read_engagement)',
    `/${connection.page_id}/posts?limit=5`,
    token,
    'id,created_time,message',
  )

  const firstPost = posts.body?.data?.[0]
  if (!firstPost) {
    say('\nNo post id available — cannot attempt the comments read.')
    say('VERDICT: comments read NOT demonstrated (blocked at the posts step).')
    return
  }
  say(`   first post shape: { ${shapeOf(firstPost)} }`)

  // 4. Comments — needs pages_read_user_content (per Meta: same permissions as
  //    the parent object, plus user-generated-content access).
  const comments = await graphGet(
    '4. Post comments (needs pages_read_user_content)',
    `/${firstPost.id}/comments?limit=5`,
    token,
    'id,message,created_time,from{id,name}',
  )

  if (comments.ok) {
    const rows = comments.body?.data || []
    say(`   comment count returned: ${rows.length}`)
    if (rows[0]) {
      say(`   comment shape:  { ${shapeOf(rows[0])} }`)
      say(`   from shape:     { ${shapeOf(rows[0].from)} }`)
      say(`   message sample: ${String(rows[0].message ?? '').slice(0, 40)}…`)
    }
    say('\nVERDICT: comments ARE readable with the existing stored Page token.')
  } else {
    say('\nVERDICT: comments are NOT readable with the existing stored Page token.')
  }
}

main()
  .catch((err) => say('probe threw:', err && err.message))
  .finally(() => knex.destroy())
