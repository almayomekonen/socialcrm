import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfConfigError, readPdfConfig } from '@/lib/pdf/config'
import { PdfRenderError, renderPdfFromHtml } from '@/lib/pdf/renderer'

/** The renderer adapter, faked at fetch. Nothing leaves this process. */

const PDF = new TextEncoder().encode('%PDF-1.7 fake')
const ok = (body: BodyInit = PDF as unknown as BodyInit) => new Response(body, { status: 200 })
const HTML = '<html dir="rtl"><body>חשבונית 42 ללקוח סודי</body></html>'

const CLOUDFLARE = { PDF_RENDERER: 'cloudflare', R2_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_BROWSER_RENDERING_API_TOKEN: 'fake-token' }
const GOTENBERG = { PDF_RENDERER: 'gotenberg', PDF_RENDER_URL: 'https://pdf.example.com/', GOTENBERG_API_BASIC_AUTH_USERNAME: 'u', GOTENBERG_API_BASIC_AUTH_PASSWORD: 'fake-password' }

let logged: string[] = []
const use = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v))
beforeEach(() => {
  vi.unstubAllEnvs()
  for (const k of ['PDF_RENDERER', 'PDF_RENDER_URL', 'PDF_RENDER_TIMEOUT_MS']) vi.stubEnv(k, '')
  logged = []
  const capture = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(capture)
  vi.spyOn(console, 'error').mockImplementation(capture)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('configuration', () => {
  it('has no default provider', () => {
    expect(() => readPdfConfig({})).toThrow(PdfConfigError)
    expect(() => readPdfConfig({ PDF_RENDERER: 'aws' })).toThrow(PdfConfigError)
  })

  it('names exactly what is missing', () => {
    try {
      readPdfConfig({ PDF_RENDERER: 'gotenberg', PDF_RENDER_URL: 'https://x' })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as PdfConfigError).missing).toEqual(['GOTENBERG_API_BASIC_AUTH_USERNAME', 'GOTENBERG_API_BASIC_AUTH_PASSWORD'])
    }
  })

  it('bounds the timeout inside the 60-second function', () => {
    expect(readPdfConfig(CLOUDFLARE).timeoutMs).toBe(30_000)
    expect(readPdfConfig({ ...CLOUDFLARE, PDF_RENDER_TIMEOUT_MS: '999999' }).timeoutMs).toBe(55_000)
    expect(readPdfConfig({ ...CLOUDFLARE, PDF_RENDER_TIMEOUT_MS: 'nonsense' }).timeoutMs).toBe(30_000)
  })

  it('a missing configuration is a typed failure, reported by name', async () => {
    await expect(renderPdfFromHtml(HTML)).rejects.toMatchObject({ failure: 'config_missing' })
    expect(logged.some((l) => l.includes('config.missing') && l.includes('PDF_RENDERER'))).toBe(true)
  })
})

describe('Cloudflare Browser Rendering', () => {
  it('sends the HTML authenticated, uncached, with scripts off, printing CSS pages', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => ok())
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).resolves.toEqual(PDF)
    const [url, init] = fetchFake.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/browser-run/pdf?cacheTTL=0`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fake-token')
    const body = JSON.parse(init.body as string)
    expect(body.html).toBe(HTML)
    expect(body.setJavaScriptEnabled).toBe(false)
    expect(body.pdfOptions).toMatchObject({ preferCSSPageSize: true, printBackground: true })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limited'],
    [500, 'bad_status'],
  ])('HTTP %i is the %s failure', async (status, failure) => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => new Response('{"errors":[{"message":"echoed חשבונית"}]}', { status }))
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).rejects.toMatchObject({ failure, httpStatus: status })
    expect(logged.join()).not.toContain('echoed')
  })

  it('a 200 that is not a PDF is never accepted as an invoice', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => ok('{"success":false}'))
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).rejects.toMatchObject({ failure: 'invalid_output' })
  })
})

describe('Gotenberg, from outside AWS', () => {
  it('authenticates with basic auth, and returns the bytes with no webhook', async () => {
    use(GOTENBERG)
    const fetchFake = vi.fn(async () => ok())
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).resolves.toEqual(PDF)
    const [url, init] = fetchFake.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://pdf.example.com/forms/chromium/convert/html')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('u:fake-password').toString('base64')}`)
    expect(Object.keys(headers).join()).not.toMatch(/webhook/i)
    expect(init.body).toBeInstanceOf(FormData)
  })
})

describe('rate limits', () => {
  const limited = (retryAfter?: string) => new Response('{}', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} })

  it('waits out a short Retry-After once, then succeeds', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => ok()).mockResolvedValueOnce(limited('2'))
    const sleep = vi.fn(async () => undefined)
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never, sleep })).resolves.toEqual(PDF)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(fetchFake).toHaveBeenCalledTimes(2)
  })

  it('retries only once', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => limited('1'))
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never, sleep: async () => undefined })).rejects.toMatchObject({ failure: 'rate_limited' })
    expect(fetchFake).toHaveBeenCalledTimes(2)
  })

  it.each([[undefined], ['3600'], ['soon']])('does not wait when Retry-After is %j (the daily limit has none)', async (value) => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => limited(value))
    const sleep = vi.fn(async () => undefined)
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never, sleep })).rejects.toMatchObject({ failure: 'rate_limited' })
    expect(sleep).not.toHaveBeenCalled()
    expect(fetchFake).toHaveBeenCalledTimes(1)
  })

  it('does not retry when the wait would not fit the deadline', async () => {
    use({ ...CLOUDFLARE, PDF_RENDER_TIMEOUT_MS: '6000' })
    const fetchFake = vi.fn(async () => limited('5'))
    const sleep = vi.fn(async () => undefined)
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never, sleep })).rejects.toMatchObject({ failure: 'rate_limited' })
    expect(fetchFake).toHaveBeenCalledTimes(1)
  })
})

describe('timeouts and transport failures', () => {
  it('a timeout is named, and logged as its own event', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' })
    })
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).rejects.toMatchObject({ failure: 'timeout' })
    expect(logged.some((l) => l.includes('pdf.render.timeout'))).toBe(true)
  })

  it('actually gives up: a hung renderer is aborted by the configured timeout', async () => {
    use({ ...CLOUDFLARE, PDF_RENDER_TIMEOUT_MS: '30' })
    const hung = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
    )
    await expect(renderPdfFromHtml(HTML, { fetch: hung as never })).rejects.toMatchObject({ failure: 'timeout' })
  })

  it('a network failure is not reported as a timeout', async () => {
    use(CLOUDFLARE)
    const fetchFake = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(renderPdfFromHtml(HTML, { fetch: fetchFake as never })).rejects.toMatchObject({ failure: 'network' })
  })

  it('never logs the invoice content or a credential', async () => {
    use(CLOUDFLARE)
    await renderPdfFromHtml(HTML, { fetch: vi.fn(async () => ok()) as never })
    await renderPdfFromHtml(HTML, { fetch: vi.fn(async () => new Response('x', { status: 500 })) as never }).catch((e) => expect(e).toBeInstanceOf(PdfRenderError))
    const all = logged.join('\n')
    expect(all).toContain('pdf.render.succeeded')
    expect(all).not.toContain('סודי')
    expect(all).not.toContain('fake-token')
  })
})
