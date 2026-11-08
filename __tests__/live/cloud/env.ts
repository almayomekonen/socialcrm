import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
// First on purpose: this module re-reads .env.test with override when it loads.
import '@/config/db'
import { HarnessRefused, assertRealBucket, assertSafeToRun, installNetworkGuard, readPrivateEnvFile, scrubSecrets, type NetworkGuard } from '../quote/safety'

/**
 * dry   (default) Nothing leaves this machine. Cloudflare is answered by local
 *       headless Chrome from the same HTML; R2 by an in-memory store under the
 *       real S3 client code.
 * real  Real Cloudflare Browser Run and real R2. Requires .env.quote-cloud.local
 *       (chmod 600, git-ignored) and a bucket that is visibly a test bucket and
 *       is confirmed by name. Writes only under tenants/<synthetic agency>/,
 *       deletes what it wrote, and fails unless the bucket is empty before and after. NOT TO BE RUN WITHOUT SEPARATE APPROVAL.
 */

export const CLOUD_AGENCY = 99801
export const CLOUD_EXEMPT_AGENCY = 99802
export const CLOUD_FILE = '.env.quote-cloud.local'
export type CloudContext = { mode: 'dry' | 'real'; guard: NetworkGuard; chrome: boolean }

assertSafeToRun(process.env)
const mode = process.env.QUOTE_CLOUD_MODE === 'real' ? 'real' : 'dry'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FAKE_ACCOUNT = 'a'.repeat(32)
const ids = `${CLOUD_AGENCY},${CLOUD_EXEMPT_AGENCY}`

const file = mode === 'real' ? (existsSync(CLOUD_FILE) ? readPrivateEnvFile(CLOUD_FILE) : null) : null
if (mode === 'real') {
  if (!file) throw new HarnessRefused(`${CLOUD_FILE} is required`)
  assertRealBucket(file)
}

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
  WA_ASSISTANT_AGENCY_IDS: ids,
  WA_ASSISTANT_QUOTES_AGENCY_IDS: ids,
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_harness_fake_token_not_real',
})

const run = promisify(execFile)
const chrome = existsSync(CHROME)

/** Dry-run Cloudflare: the real request is received and printed by local Chrome. */
async function fakeCloudflare(init?: RequestInit): Promise<Response> {
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
  if (url.startsWith('https://api.cloudflare.com/')) return fakeCloudflare(init)
  // The signed download link: answered from the in-memory bucket.
  const store = (globalThis as unknown as { __dryBucket?: Map<string, { Body: Uint8Array }> }).__dryBucket
  const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'))
  const hit = store?.get(key)
  return hit ? new Response(Buffer.from(hit.Body), { status: 200 }) : new Response('', { status: 404 })
}) as typeof fetch

const guard = installNetworkGuard({ allowedHosts: ['api.cloudflare.com', `${account}.r2.cloudflarestorage.com`], inner: mode === 'dry' ? dryFetch : undefined })
;(globalThis as Record<string, unknown>).__quoteCloud = { mode, guard, chrome } satisfies CloudContext
