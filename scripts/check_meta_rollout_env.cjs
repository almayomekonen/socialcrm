/**
 * check_meta_rollout_env.cjs — are the variables the Meta App Review rollout
 * needs present? PRESENCE ONLY: no value, no length, no prefix is ever printed.
 *
 *   node scripts/check_meta_rollout_env.cjs                   # reads process env (+ ENV_FILE if set)
 *   ENV_FILE=.env.local node scripts/check_meta_rollout_env.cjs --agency 103
 *
 * With --agency, each rollout pair also reports whether that agency is ENABLED
 * (flag is exactly "1" and the allowlist names it or is "all") — a yes/no, not
 * the value. SECRETS_ENC_KEY additionally reports whether it has the required
 * shape (base64 of 32 bytes), again as yes/no.
 *
 * For Vercel production, where values are not readable, check names with:
 *   vercel env ls production | awk '{print $1}'
 */
if (process.env.ENV_FILE) require('dotenv').config({ path: process.env.ENV_FILE, override: true })

const REQUIRED = [
  ['META_APP_ID', 'OAuth + webhook app'],
  ['META_APP_SECRET', 'webhook signature + appsecret_proof'],
  ['META_REDIRECT_URI', 'OAuth redirect (Page + ads flows)'],
  ['META_VERIFY_TOKEN', 'webhook verification'],
  ['SECRETS_ENC_KEY', 'Page/ad token sealing — connect fails closed without it'],
  ['JWT_SECRET', 'session + legacy pending-Pages cookie'],
  ['DATABASE_URL', 'database'],
]
const ONE_OF = [['AUTOMATION_API_KEY', 'CRON_SECRET', 'cron auth for /api/cron/messenger-events']]
const ROLLOUT = [
  ['FACEBOOK_COMMENTS_ENABLED', 'FACEBOOK_COMMENTS_AGENCY_ALLOWLIST'],
  ['FACEBOOK_COMMENT_REPLIES_ENABLED', 'FACEBOOK_COMMENT_REPLIES_AGENCY_ALLOWLIST'],
  ['FACEBOOK_MESSENGER_ENABLED', 'FACEBOOK_MESSENGER_AGENCY_ALLOWLIST'],
  ['FACEBOOK_ADS_REPORTING_ENABLED', 'FACEBOOK_ADS_REPORTING_AGENCY_ALLOWLIST'],
]

const present = (name) => typeof process.env[name] === 'string' && process.env[name].length > 0
const agencyArg = process.argv.indexOf('--agency') === -1 ? null : Number(process.argv[process.argv.indexOf('--agency') + 1])

function enabledFor(flag, list, agency) {
  if (process.env[flag] !== '1') return false
  const raw = (process.env[list] || '').trim()
  if (raw.toLowerCase() === 'all') return true
  return raw.split(',').map((s) => Number(s.trim())).includes(agency)
}

let missing = 0
for (const [name, why] of REQUIRED) {
  const ok = present(name)
  if (!ok) missing++
  let extra = ''
  if (name === 'SECRETS_ENC_KEY' && ok) {
    const shapeOk = Buffer.from(process.env.SECRETS_ENC_KEY, 'base64').length === 32
    extra = ` shape_ok=${shapeOk ? 'yes' : 'no'}`
    if (!shapeOk) missing++
  }
  console.log(`${ok ? 'present' : 'MISSING'}\t${name}${extra}\t(${why})`)
}
for (const [a, b, why] of ONE_OF) {
  const ok = present(a) || present(b)
  if (!ok) missing++
  console.log(`${ok ? 'present' : 'MISSING'}\t${a} or ${b}\t(${why})`)
}
for (const [flag, list] of ROLLOUT) {
  const state = `${present(flag) ? 'set' : 'unset'}\t${flag}\t${present(list) ? 'set' : 'unset'}\t${list}`
  console.log(agencyArg === null ? state : `${state}\tagency_${agencyArg}_enabled=${enabledFor(flag, list, agencyArg) ? 'yes' : 'no'}`)
}
if (missing > 0) process.exitCode = 1
