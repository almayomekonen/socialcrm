import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import puppeteer, { type Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

// Three execution paths, priority order:
//   1. CHROMIUM_EXECUTABLE_PATH env var — explicit override (CI, opt-in).
//   2. Locally-installed Chrome at a known path — auto-detected so dev
//      works without anyone setting the env var by hand.
//   3. @sparticuz/chromium — the chromium binary is bundled with the
//      function (no runtime download). On cold start the package extracts
//      the brotli-compressed bin into /tmp; subsequent renders on the
//      same warm container reuse it. This replaces @sparticuz/chromium-min,
//      which downloaded ~66 MB from GitHub at every cold start and timed
//      out inside Vercel's function cap before the launch could even fire.
//
// Bundle impact: +~63 MB to the function bundle (compressed chromium +
// swiftshader + AWS Lambda glibc layer). Well within Vercel's 250 MB
// uncompressed function-size limit.
//
// Every Puppeteer step is wrapped in a timeout so a hang surfaces as a
// classified error instead of leaving a bill_documents row stuck in
// 'rendering' forever.

const LOCAL_ARGS = ['--no-sandbox', '--disable-setuid-sandbox']

const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const LAUNCH_TIMEOUT_MS = Number(process.env.PDF_LAUNCH_TIMEOUT_MS ?? 30_000)
const RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 30_000)

export type HtmlToPdfResult = {
  bytes: Uint8Array
  contentHash: string
  byteSize: number
}

let browserPromise: Promise<Browser> | null = null

function log(stage: string, payload: Record<string, unknown> = {}): void {
  console.log(`[billing.pdf] ${stage}`, JSON.stringify(payload))
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`billing.pdf.timeout:${label}:${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function detectLocalChromePath(): string | null {
  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // Permission error on a path we can't reach — keep scanning.
    }
  }
  return null
}

async function resolveExecutablePath(): Promise<{ path: string; source: string }> {
  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim()
  if (envPath) return { path: envPath, source: 'env' }

  const detected = detectLocalChromePath()
  if (detected) return { path: detected, source: 'local' }

  // No URL parameter — the binary ships with the package and is extracted
  // from /var/task/node_modules/@sparticuz/chromium/bin/chromium.br into
  // /tmp on first call. Cached for the lifetime of the warm container.
  log('chromium.extract.start')
  const path = await withTimeout(chromium.executablePath(), LAUNCH_TIMEOUT_MS, 'extract')
  log('chromium.extract.done', { path })
  return { path, source: 'chromium-bundled' }
}

async function launchBrowser(): Promise<Browser> {
  const { path: executablePath, source } = await resolveExecutablePath()
  log('chromium.launch.start', { executablePath, source })

  // Lambda-tuned chromium.args are only safe with the sparticuz binary.
  // For desktop Chrome (env path or auto-detected) the minimal sandbox
  // overrides are enough — Lambda's single-process/headless-old flags
  // break some desktop builds and produce silent hangs.
  const useLambdaArgs = source === 'chromium-bundled'
  const browser = await withTimeout(
    puppeteer.launch({
      args: useLambdaArgs ? chromium.args : LOCAL_ARGS,
      defaultViewport: useLambdaArgs ? chromium.defaultViewport : null,
      executablePath,
      headless: true,
    }),
    LAUNCH_TIMEOUT_MS,
    'launch',
  )
  log('chromium.launch.ok', { source })
  return browser
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.connected) return existing
    } catch {
      // Previous launch failed — fall through and retry below.
    }
    browserPromise = null
  }
  browserPromise = launchBrowser().catch((err) => {
    // Clear the cached promise on failure so the NEXT call retries
    // instead of forever returning the same rejected promise.
    browserPromise = null
    throw err
  })
  return browserPromise
}

export async function htmlToPdfBytes(html: string): Promise<HtmlToPdfResult> {
  const t0 = Date.now()
  log('render.start', { htmlBytes: html.length })

  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await withTimeout(page.setContent(html, { waitUntil: 'domcontentloaded' }), RENDER_TIMEOUT_MS, 'setContent')

    const buffer = await withTimeout(
      page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: true,
      }),
      RENDER_TIMEOUT_MS,
      'pdf',
    )

    const bytes = new Uint8Array(buffer)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    log('render.ok', { byteSize: bytes.byteLength, durationMs: Date.now() - t0 })
    return { bytes, contentHash, byteSize: bytes.byteLength }
  } catch (err) {
    log('render.fail', {
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    // Leave the browser alive for the next render in the same warm
    // container. The browser closes when the container is recycled.
    await page.close().catch(() => {})
  }
}
