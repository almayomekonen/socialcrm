/**
 * facebook_comments_canary.cjs — Page `feed` webhook canary (experiment only).
 *
 * Subscribes ONE explicitly opted-in Page to `leadgen,feed` so we can observe
 * whether Meta delivers usable comment data under our EXISTING permissions
 * (`pages_show_list`, `pages_manage_metadata`) — see
 * docs/facebook-comments-feasibility-audit.md §F.
 *
 *   node scripts/facebook_comments_canary.cjs status
 *   node scripts/facebook_comments_canary.cjs subscribe
 *   node scripts/facebook_comments_canary.cjs unsubscribe   # → leadgen only
 *
 *   ENV_FILE=.env.production.local node scripts/facebook_comments_canary.cjs status
 *
 * GATE — fails closed. `FACEBOOK_COMMENTS_CANARY_PAGE_ID` must be set AND must
 * match a row in `facebook_pages`. No env var, no Page, no action. Never
 * operates on "all Pages", and never accepts a token or Page id from anywhere
 * but the database.
 *
 * ROLLBACK — `unsubscribe` re-POSTs `subscribed_fields=leadgen`, which is
 * exactly the state the normal connect flow creates. Meta REPLACES the field
 * set on POST, so this restores the Page byte-for-byte.
 *
 * SECRETS — the Page access token is read from the DB, sent only in a form body
 * or an Authorization header, and never printed. `say()` scrubs known secrets
 * from every line as a backstop.
 */
const ENV_FILE = process.env.ENV_FILE || '.env.local'
require('dotenv').config({ path: ENV_FILE, override: true })
const { resolvePageToken } = require('./resolvePageToken.cjs')

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

/** The shipped default; `unsubscribe` restores exactly this. */
const BASELINE_FIELDS = 'leadgen'
const CANARY_FIELDS = 'leadgen,feed'

const secrets = []
function say(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
  console.log(secrets.reduce((acc, s) => acc.split(s).join('<redacted>'), line))
}

const mask = (pageId) => `…${String(pageId).slice(-4)}`

/** Print a Meta error with every field the audit asked for. Never credentials. */
function reportError(status, body) {
  const e = (body && body.error) || {}
  say(`[FacebookCommentsCanary] FAILED  http=${status}`)
  say(`[FacebookCommentsCanary]   code=${e.code ?? 'n/a'} subcode=${e.error_subcode ?? 'n/a'} type=${e.type ?? 'n/a'}`)
  say(`[FacebookCommentsCanary]   message=${e.message ?? '(none)'}`)
  say(`[FacebookCommentsCanary]   fbtrace_id=${e.fbtrace_id ?? 'n/a'}`)
}

/** GET /{pageId}/subscribed_apps — token travels in the header, not the URL. */
async function readSubscription(pageId, token) {
  const res = await fetch(`${GRAPH_BASE}/${pageId}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || (body && body.error)) {
    reportError(res.status, body)
    return null
  }
  return Array.isArray(body && body.data) ? body.data : []
}

/** Print the live field set and whether the two fields we care about are on. */
function printFields(apps) {
  const fields = new Set()
  for (const app of apps) for (const f of app.subscribed_fields || []) fields.add(f)
  const list = [...fields].sort()
  say(`[FacebookCommentsCanary] subscribed_fields=${list.length ? list.join(',') : '(none)'}`)
  say(`[FacebookCommentsCanary]   leadgen: ${fields.has('leadgen') ? 'ACTIVE' : 'absent'}`)
  say(`[FacebookCommentsCanary]   feed:    ${fields.has('feed') ? 'ACTIVE' : 'absent'}`)
  return fields
}

/**
 * POST /{pageId}/subscribed_apps. Uses the same form-body shape as the shipped
 * connect route — a proven call, not a new pattern invented for the canary.
 */
async function writeSubscription(pageId, token, fields) {
  const res = await fetch(`${GRAPH_BASE}/${pageId}/subscribed_apps`, {
    method: 'POST',
    body: new URLSearchParams({ access_token: token, subscribed_fields: fields }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || (body && body.error)) {
    reportError(res.status, body)
    return false
  }
  say(`[FacebookCommentsCanary] Meta accepted the change (success=${body && body.success})`)
  return true
}

/** Resolve the canary Page from env + DB, or explain precisely why we stopped. */
async function resolveCanary() {
  const canaryPageId = (process.env.FACEBOOK_COMMENTS_CANARY_PAGE_ID || '').trim()
  if (!canaryPageId) {
    say('[FacebookCommentsCanary] ABORT — FACEBOOK_COMMENTS_CANARY_PAGE_ID is not set.')
    say('[FacebookCommentsCanary] The gate fails closed on purpose; set it to ONE Page id and re-run.')
    return null
  }

  const row = await knex('facebook_pages').where({ page_id: canaryPageId }).first()
  if (!row) {
    say(`[FacebookCommentsCanary] ABORT — pageId=${mask(canaryPageId)} is not connected in this database.`)
    say(`[FacebookCommentsCanary] env file=${ENV_FILE}. A Page must be connected before it can be a canary.`)
    return null
  }

  // Sealed at rest; resolve once into `token`, and scrub both forms from every output line.
  secrets.push(row.page_access_token)
  const token = resolvePageToken(row.page_access_token)
  secrets.push(token)
  if (process.env.META_APP_SECRET) secrets.push(process.env.META_APP_SECRET)

  say(`[FacebookCommentsCanary] pageId=${mask(row.page_id)}`)
  say(`[FacebookCommentsCanary] agency_id=${row.agency_id} user_id=${row.user_id} health=${row.health_status}`)
  return { page_id: row.page_id, agency_id: row.agency_id, user_id: row.user_id, health_status: row.health_status, token }
}

const COMMANDS = {
  async status(row) {
    const apps = await readSubscription(row.page_id, row.token)
    if (!apps) return
    printFields(apps)
  },

  async subscribe(row) {
    say(`[FacebookCommentsCanary] subscribing fields=${CANARY_FIELDS}`)
    if (!(await writeSubscription(row.page_id, row.token, CANARY_FIELDS))) return

    // Verify rather than trust the 200 — a successful POST is not proof that
    // Meta actually retained `feed` under our permission set.
    const apps = await readSubscription(row.page_id, row.token)
    if (!apps) return
    const fields = printFields(apps)
    say(
      fields.has('feed')
        ? '[FacebookCommentsCanary] RESULT: feed subscription CONFIRMED. Comment on a Page post, then read the logs.'
        : '[FacebookCommentsCanary] RESULT: feed was NOT retained — the permission set does not support it.',
    )
  },

  async unsubscribe(row) {
    say(`[FacebookCommentsCanary] restoring fields=${BASELINE_FIELDS}`)
    if (!(await writeSubscription(row.page_id, row.token, BASELINE_FIELDS))) return

    const apps = await readSubscription(row.page_id, row.token)
    if (!apps) return
    const fields = printFields(apps)
    say(
      !fields.has('feed') && fields.has('leadgen')
        ? '[FacebookCommentsCanary] RESULT: rolled back. The Page is on the shipped leadgen-only subscription.'
        : '[FacebookCommentsCanary] RESULT: unexpected field set after rollback — inspect before leaving it.',
    )
  },
}

async function main() {
  const command = process.argv[2]
  if (!command || !COMMANDS[command]) {
    say(`Usage: node scripts/facebook_comments_canary.cjs <${Object.keys(COMMANDS).join('|')}>`)
    return
  }

  say(`[FacebookCommentsCanary] graph=${GRAPH_VERSION} env=${ENV_FILE} command=${command}`)
  const row = await resolveCanary()
  if (!row) return
  await COMMANDS[command](row)
}

main()
  .catch((err) => say('[FacebookCommentsCanary] threw:', err && err.message))
  .finally(() => knex.destroy())
