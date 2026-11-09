import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
// First on purpose: this module re-reads .env.test with override when it loads.
import '@/config/db'
import { HarnessRefused, assertRealBucket, assertSafeToRun, installNetworkGuard, readPrivateEnvFile, scrubSecrets, type NetworkGuard } from '../quote/safety'
import { createRenderLimiter, installLogRedaction, readCloudLimits, type CloudLimits, type RenderLimitState } from './renderLimit'
import { createR2Counter, r2LimitDefaults, readR2Limits, type R2Limits, type R2State } from './r2Limit'

/**
 * dry   (default) Nothing leaves this machine. Cloudflare is answered by local
 *       headless Chrome from the same HTML; R2 by an in-memory store under the
 *       real S3 client code.
 * real  Real Cloudflare Browser Run and real R2. Requires .env.quote-cloud.local
 *       (chmod 600, git-ignored) and a bucket that is visibly a test bucket and
 *       is confirmed by name. Writes only under tenants/<synthetic agency>/,
 *       deletes what it wrote, and fails unless the bucket is empty before and after.
 *       Needs QUOTE_CLOUD_MAX_RENDERS, QUOTE_CLOUD_MAX_RETRIES and the five
 *       QUOTE_CLOUD_MAX_R2_* limits in that file.
 *
 * The bucket-scoped R2 token is the actual boundary against Production: the checks
 * here can see a bucket's name, not whose it is. NOT TO BE RUN WITHOUT SEPARATE APPROVAL.
 */

export const CLOUD_AGENCY = 99801
export const CLOUD_EXEMPT_AGENCY = 99802
export const CLOUD_FILE = '.env.quote-cloud.local'
export type CloudContext = { mode: 'dry' | 'real'; guard: NetworkGuard; chrome: boolean; limits: CloudLimits; limiter: RenderLimitState; r2Limits: R2Limits; r2: R2State; r2Counter: ReturnType<typeof createR2Counter> }

assertSafeToRun(process.env)
const mode = process.env.QUOTE_CLOUD_MODE === 'real' ? 'real' : 'dry'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FAKE_ACCOUNT = 'a'.repeat(32)
const ids = `${CLOUD_AGENCY},${CLOUD_EXEMPT_AGENCY}`

if (mode === 'real' && (process.env.QUOTE_CLOUD_DRY_SEED !== undefined || process.env.QUOTE_CLOUD_DRY_LOG !== undefined)) throw new HarnessRefused('QUOTE_CLOUD_DRY_* is dry-only')
const file = mode === 'real' ? (existsSync(CLOUD_FILE) ? readPrivateEnvFile(CLOUD_FILE) : null) : null
if (mode === 'real') {
  if (!file) throw new HarnessRefused(`${CLOUD_FILE} is required`)
  assertRealBucket(file)
}
// A real run takes both limits from the file, with no default. A dry run may be tightened by the guard suite.
const limits = readCloudLimits(file ?? { QUOTE_CLOUD_MAX_RENDERS: process.env.QUOTE_CLOUD_MAX_RENDERS ?? '20', QUOTE_CLOUD_MAX_RETRIES: process.env.QUOTE_CLOUD_MAX_RETRIES ?? '3' })
const r2Limits = readR2Limits(file ?? r2LimitDefaults(process.env))

scrubSecrets(process.env, ['JWT_SECRET', 'SECRETS_ENC_KEY', 'MOBILE_JWT_SECRET', 'MCP_JWT_SECRET'])
const account = file?.R2_ACCOUNT_ID ?? FAKE_ACCOUNT
Object.assign(process.env, {
  PDF_RENDERER: 'cloudflare',
  PDF_RENDER_TIMEOUT_MS: '55000',
  R2_ACCOUNT_ID: account,
  R2_ACCESS_KEY_ID: file?.R2_ACCESS_KEY_ID ?? 'FAKEKEYID',
  R2_SECRET_ACCESS_KEY: file?.R2_SECRET_ACCESS_KEY ?? 'fake-secret',
  R2_BUCKET_NAME: file?.R2_BUCKET_NAME ?? 'dry-run-test-bucket',
  CLOUDFLARE_BROWSER_RENDERING_API_TOKEN: file?.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ?? 'fake-token',
  // One S3 call is one HTTP attempt: the SDK's own retries would not be counted by the limits.
  AWS_MAX_ATTEMPTS: '1',
  WA_ASSISTANT_AGENCY_IDS: ids,
  WA_ASSISTANT_QUOTES_AGENCY_IDS: ids,
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_harness_fake_token_not_real',
})

const run = promisify(execFile)
const chrome = existsSync(CHROME)

/** Dry-run Cloudflare: the real request is received and printed by local Chrome. */
async function fakeCloudflare(init?: RequestInit): Promise<Response> {
  if (new Headers(init?.headers).get('authorization') !== 'Bearer fake-token') return new Response('{"success":false}', { status: 401 })
  const { html } = JSON.parse(String(init?.body)) as { html: string }
  if (!chrome) return new Response(Buffer.from('%PDF-1.7 dry run without chrome'), { status: 200 })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'quote-cloud-'))
  try {
    writeFileSync(path.join(dir, 'in.html'), html)
    await run(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${path.join(dir, 'p')}`, `--print-to-pdf=${path.join(dir, 'out.pdf')}`, `file://${path.join(dir, 'in.html')}`], { timeout: 120_000 })
    return new Response(readFileSync(path.join(dir, 'out.pdf')), { status: 200, headers: { 'content-type': 'application/pdf' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const dryFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('https://api.cloudflare.com/')) {
    // Like real fetch, the stand-in gives up when the caller's timeout fires.
    const signal = init?.signal
    const aborted = new Promise<never>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason)
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return Promise.race([aborted, fakeCloudflare(init)])
  }
  // The signed download link: answered from the in-memory bucket.
  const store = (globalThis as unknown as { __dryBucket?: Map<string, { Body: Uint8Array }> }).__dryBucket
  const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'))
  const hit = store?.get(key)
  if (!hit) return new Response('', { status: 404 })
  // What S3 and R2 do with a signed link's response-* parameters, so the same header checks run in both modes.
  const { searchParams } = new URL(url)
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(searchParams.get('X-Amz-Date') ?? '') ?? []
  const expiresAt = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`) + Number(searchParams.get('X-Amz-Expires')) * 1000
  const offset = (globalThis as unknown as { __dryClockOffsetMs?: number }).__dryClockOffsetMs ?? 0
  if (!(Date.now() + offset <= expiresAt)) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
  return new Response(Buffer.from(hit.Body), { status: 200, headers: { 'content-type': searchParams.get('response-content-type') ?? 'binary/octet-stream', 'content-disposition': searchParams.get('response-content-disposition') ?? '' } })
}) as typeof fetch

const guard = installNetworkGuard({ allowedHosts: ['api.cloudflare.com', `${account}.r2.cloudflarestorage.com`], inner: mode === 'dry' ? dryFetch : undefined })
const limiter = createRenderLimiter({ inner: globalThis.fetch, accountId: account, limits })
const r2Counter = createR2Counter(r2Limits)
const r2Host = `${account}.r2.cloudflarestorage.com`
// A signed download link is a read that never passes through the S3 client.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (new URL(String(input instanceof Request ? input.url : input)).hostname !== r2Host) return limiter.fetch(input, init)
  r2Counter.begin('read')
  const res = await limiter.fetch(input, init)
  if (res.ok) r2Counter.succeed('read')
  return res
}) as typeof fetch
installLogRedaction([file?.R2_SECRET_ACCESS_KEY ?? 'fake-secret', file?.CLOUDFLARE_BROWSER_RENDERING_API_TOKEN ?? 'fake-token', file?.R2_ACCESS_KEY_ID ?? 'FAKEKEYID'])
;(globalThis as Record<string, unknown>).__quoteCloud = { mode, guard, chrome, limits, limiter: limiter.state, r2Limits, r2: r2Counter.state, r2Counter } satisfies CloudContext
