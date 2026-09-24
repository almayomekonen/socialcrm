/**
 * ONE-OFF credential-compatibility check, authorized by the owner 2026-09-16.
 *
 * Creates AT MOST ONE unused Get Token Only hosted-page process per environment
 * to learn whether the supplied userId + pageCode pair is accepted there. It
 * enters no card, submits no form, saves no token, authorizes and captures
 * nothing, and never calls ApproveTransaction. No notifyUrl is sent, so no
 * callback reaches any application.
 *
 * Deliberately SEPARATE from scripts/grow-sandbox-probe.ts: that probe refuses
 * anything but sandbox, and this check must reach both hosts. Its guard is not
 * touched, reused or relaxed.
 *
 * Exactly one request per environment. No retries. A timeout is reported as
 * UNKNOWN, never as a rejection.
 *
 *   npx tsx scripts/grow-credential-validation.ts
 */
import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { parse } from 'dotenv'
import { GROW_PRODUCTION_BASE_URL, GROW_SANDBOX_BASE_URL, getGrowApiConfig } from '../lib/payments/grow/config'
import { postGrowForm, GrowTransportError } from '../lib/payments/grow/http'
import { TOKEN_PROCESS_DESCRIPTION } from '../lib/payments/cardTrial/terms'

const ENV_FILE = '.env.grow-validation.local'
const EXPECTED_BASE = { sandbox: GROW_SANDBOX_BASE_URL, production: GROW_PRODUCTION_BASE_URL } as const
type Env = keyof typeof EXPECTED_BASE

/** Return URLs are never used — the form is never submitted — but the API wants them. */
const RETURN_BASE = 'https://socialcrm-git-feat-card-required-trial-almayos-projects.vercel.app'

const secrets: string[] = []
const redact = (s: string) => secrets.reduce((acc, v) => (v ? acc.split(v).join('«redacted»') : acc), s)

function gitIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path])
    return true
  } catch {
    return false
  }
}

function credentials() {
  if (!existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} is absent — populate it first`)
  if (!gitIgnored(ENV_FILE)) throw new Error(`${ENV_FILE} is not gitignored — refusing`)
  const v = parse(readFileSync(ENV_FILE))
  const required = ['GROW_USER_ID', 'GROW_PAGE_CODE_TOKEN', 'GROW_VALIDATION_FULL_NAME', 'GROW_VALIDATION_PHONE'] as const
  for (const k of required) if (!v[k]?.trim()) throw new Error(`${ENV_FILE} is missing ${k}`)
  secrets.push(v.GROW_USER_ID.trim(), v.GROW_PAGE_CODE_TOKEN.trim())
  return {
    userId: v.GROW_USER_ID.trim(),
    pageCode: v.GROW_PAGE_CODE_TOKEN.trim(),
    // Owner-approved contact details. Never invented here: absent ⇒ refuse.
    fullName: v.GROW_VALIDATION_FULL_NAME.trim(),
    phone: v.GROW_VALIDATION_PHONE.trim(),
    email: v.GROW_VALIDATION_EMAIL?.trim() || null,
  }
}

type Result = { env: Env; created: boolean | 'unknown'; errorId: number | null; errorMessage: string; note: string }

async function check(env: Env, c: ReturnType<typeof credentials>): Promise<Result> {
  process.env.GROW_MODE = env
  process.env.GROW_USER_ID = c.userId
  process.env.GROW_PAGE_CODE_TOKEN = c.pageCode
  const { baseUrl } = getGrowApiConfig()
  if (baseUrl !== EXPECTED_BASE[env]) throw new Error(`resolved base URL is not the official ${env} host`)

  const fields: Record<string, string | number> = {
    pageCode: c.pageCode,
    userId: c.userId,
    chargeType: 3,
    sum: 1,
    saveCardToken: 1,
    successUrl: `${RETURN_BASE}/billing/success?source=card_trial`,
    cancelUrl: `${RETURN_BASE}/dashboard`,
    description: TOKEN_PROCESS_DESCRIPTION,
    'pageField[fullName]': c.fullName,
    'pageField[phone]': c.phone,
    ...(c.email ? { 'pageField[email]': c.email } : {}),
    // notifyUrl deliberately omitted: no callback may reach any application.
  }

  try {
    const env0 = await postGrowForm('createPaymentProcess', fields)
    if (env0.status === 1) {
      const d = (env0.data ?? {}) as Record<string, unknown>
      // The URL, processId and processToken are sensitive and are NOT printed.
      const complete = Boolean(d.processId && d.processToken && d.url)
      return {
        env,
        created: complete,
        errorId: null,
        errorMessage: '',
        note: complete ? 'hosted-page process created and left unused' : 'accepted but response incomplete',
      }
    }
    return { env, created: false, errorId: env0.err?.id ?? null, errorMessage: redact(env0.err?.message ?? ''), note: 'rejected by Grow' }
  } catch (err) {
    if (err instanceof GrowTransportError) {
      return { env, created: 'unknown', errorId: null, errorMessage: '', note: `transport ${err.reason} — OUTCOME UNKNOWN, not a rejection` }
    }
    return { env, created: 'unknown', errorId: null, errorMessage: redact(String(err)).slice(0, 120), note: 'OUTCOME UNKNOWN' }
  }
}

async function main() {
  const c = credentials()
  const results: Result[] = []
  for (const env of ['sandbox', 'production'] as const) {
    results.push(await check(env, c)) // exactly one request each, in order, no retries
  }
  console.log('\nenvironment | created | errorId | note')
  console.log('------------|---------|---------|-----')
  for (const r of results) console.log(`${r.env.padEnd(11)} | ${String(r.created).padEnd(7)} | ${String(r.errorId ?? '-').padEnd(7)} | ${r.note}${r.errorMessage ? ` (${r.errorMessage})` : ''}`)
  const accepted = results.filter((r) => r.created === true).map((r) => r.env)
  console.log(
    `\nverdict: ${
      accepted.length === 1
        ? `identifiers are compatible with ${accepted[0]}`
        : accepted.length === 2
          ? 'BOTH environments accepted the pair — do not choose one; ask Grow'
          : 'no environment accepted the pair (or the outcome is unknown)'
    }`,
  )
  console.log('page creation proves the userId+pageCode pair is accepted TOGETHER. It does NOT prove')
  console.log('token-save permission, the token-only page type, or charging readiness.')
}

main().catch((err) => {
  console.error(redact(String(err)))
  process.exit(1)
})
