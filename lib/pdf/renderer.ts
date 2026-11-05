import 'server-only'
import { logStorageEvent } from '@/lib/storage/events'
import { PdfConfigError, readPdfConfig, type PdfConfig } from './config'

/**
 * HTML in, PDF bytes out. Nothing else in the app knows which renderer is running.
 *
 *   cloudflare  Browser Run's (formerly Browser Rendering) REST endpoint, with no
 *               infrastructure of our own
 *   gotenberg   the pinned container in infra/gotenberg/, on any non-AWS host
 *
 * Both are Chromium printing the same self-contained HTML (fonts embedded as data
 * URIs), both with JavaScript off, and neither is reachable without credentials.
 * The bytes come back to this process, so there is no webhook, no renderer access
 * to storage, and no window where a render can vanish between two systems.
 *
 * Provider response bodies are never logged: they can echo the invoice HTML.
 */

export type PdfFailure = 'timeout' | 'rate_limited' | 'auth' | 'bad_status' | 'network' | 'invalid_output' | 'config_missing'

export class PdfRenderError extends Error {
  readonly failure: PdfFailure
  readonly httpStatus: number | null
  constructor(failure: PdfFailure, httpStatus: number | null = null) {
    super(`pdf.render_${failure}${httpStatus ? `:${httpStatus}` : ''}`)
    this.name = 'PdfRenderError'
    this.failure = failure
    this.httpStatus = httpStatus
  }
}

type Fetch = typeof fetch
type Deps = { fetch?: Fetch; sleep?: (ms: number) => Promise<void> }

/** The longest Retry-After worth waiting out inside the request that is rendering. */
const MAX_RETRY_AFTER_MS = 10_000
const MIN_ATTEMPT_MS = 5_000

function cloudflareRequest(config: Extract<PdfConfig, { provider: 'cloudflare' }>, html: string) {
  // cacheTTL=0: invoice HTML must not sit in the provider's response cache.
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/browser-run/pdf?cacheTTL=0`
  const init: RequestInit = {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      setJavaScriptEnabled: false,
      rejectResourceTypes: ['script', 'xhr', 'fetch', 'websocket', 'eventsource'],
      gotoOptions: { waitUntil: 'load', timeout: config.timeoutMs },
      pdfOptions: { preferCSSPageSize: true, printBackground: true, timeout: config.timeoutMs },
    }),
  }
  return { url, init }
}

function gotenbergRequest(config: Extract<PdfConfig, { provider: 'gotenberg' }>, html: string) {
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  form.append('paperWidth', '8.27')
  form.append('paperHeight', '11.7')
  form.append('marginTop', '0')
  form.append('marginBottom', '0')
  form.append('marginLeft', '0')
  form.append('marginRight', '0')
  form.append('preferCssPageSize', 'true')
  form.append('printBackground', 'true')
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64')
  const init: RequestInit = { method: 'POST', headers: { Authorization: `Basic ${credentials}` }, body: form }
  return { url: `${config.url}/forms/chromium/convert/html`, init }
}

function failureFor(status: number): PdfFailure {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  return 'bad_status'
}

/** The magic bytes. A provider can answer 200 with a JSON error, and that must not be stored as an invoice. */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-'
}

export async function renderPdfFromHtml(html: string, deps: Deps = {}): Promise<Uint8Array> {
  let config: PdfConfig
  try {
    config = readPdfConfig()
  } catch (err) {
    if (err instanceof PdfConfigError) {
      logStorageEvent('config.missing', { reason: err.message })
      throw new PdfRenderError('config_missing')
    }
    throw err
  }

  const renderer = config.provider
  const startedAt = Date.now()
  const fail = (failure: PdfFailure, httpStatus: number | null = null) => {
    const fields = { renderer, reason: failure, httpStatus, latencyMs: Date.now() - startedAt }
    logStorageEvent(failure === 'timeout' ? 'pdf.render.timeout' : 'pdf.render.failed', fields)
    return new PdfRenderError(failure, httpStatus)
  }

  const { url, init } = config.provider === 'cloudflare' ? cloudflareRequest(config, html) : gotenbergRequest(config, html)

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = startedAt + config.timeoutMs
  let response: Response
  let bytes: Uint8Array
  try {
    response = await (deps.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) })
    // One retry, only for a rate limit that says when, and only if it still fits the deadline.
    const waitMs = Number(response.headers.get('retry-after')) * 1000
    const fits = waitMs > 0 && waitMs <= MAX_RETRY_AFTER_MS && Date.now() + waitMs + MIN_ATTEMPT_MS <= deadline
    if (response.status === 429 && fits) {
      await sleep(waitMs)
      response = await (deps.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1)) })
    }
    if (!response.ok) throw fail(failureFor(response.status), response.status)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    if (err instanceof PdfRenderError) throw err
    const name = (err as { name?: string })?.name
    throw fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network')
  }

  if (!isPdf(bytes)) throw fail('invalid_output', response.status)
  logStorageEvent('pdf.render.succeeded', { renderer, size: bytes.byteLength, latencyMs: Date.now() - startedAt })
  return bytes
}
