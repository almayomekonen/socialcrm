import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import puppeteer, { type Browser } from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'

const DEFAULT_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar'

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
const PREFLIGHT_TIMEOUT_MS = Number(process.env.PDF_PREFLIGHT_TIMEOUT_MS ?? 10_000)

const MIN_PACK_BYTES = 5_000_000

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
    } catch {}
  }
  return null
}

async function preflightChromiumPack(url: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('chromium.pack.preflight.network_fail', { url, error: message })
    throw new Error(`billing.pdf.chromium_pack_unreachable:${message}`)
  } finally {
    clearTimeout(timer)
  }

  const status = res.status
  const contentType = res.headers.get('content-type') ?? ''
  const contentLengthRaw = res.headers.get('content-length')
  const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN

  log('chromium.pack.preflight', {
    url,
    status,
    contentType,
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
  })

  if (!res.ok) {
    throw new Error(`billing.pdf.chromium_pack_http:${status}`)
  }

  if (contentType.toLowerCase().startsWith('text/html')) {
    throw new Error('billing.pdf.chromium_pack_html_body')
  }

  if (Number.isFinite(contentLength) && contentLength < MIN_PACK_BYTES) {
    throw new Error(`billing.pdf.chromium_pack_too_small:${contentLength}`)
  }
}

async function resolveExecutablePath(): Promise<{ path: string; source: string }> {
  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim()
  if (envPath) return { path: envPath, source: 'env' }

  const detected = detectLocalChromePath()
  if (detected) return { path: detected, source: 'local' }

  const packUrl = process.env.CHROMIUM_PACK_URL?.trim() || DEFAULT_PACK_URL
  log('chromium.pack.resolve', { url: packUrl, source: process.env.CHROMIUM_PACK_URL ? 'env' : 'default' })

  await preflightChromiumPack(packUrl)

  const path = await chromium.executablePath(packUrl)
  return { path, source: 'chromium-min' }
}

async function launchBrowser(): Promise<Browser> {
  const { path: executablePath, source } = await resolveExecutablePath()

  const useLambdaArgs = source === 'chromium-min'
  return withTimeout(
    puppeteer.launch({
      args: useLambdaArgs ? chromium.args : LOCAL_ARGS,
      defaultViewport: useLambdaArgs ? chromium.defaultViewport : null,
      executablePath,
      headless: true,
    }),
    LAUNCH_TIMEOUT_MS,
    'launch',
  )
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.connected) return existing
    } catch {}
    browserPromise = null
  }
  browserPromise = launchBrowser().catch((err) => {
    browserPromise = null
    throw err
  })
  return browserPromise
}

export async function htmlToPdfBytes(html: string): Promise<HtmlToPdfResult> {
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
    return { bytes, contentHash, byteSize: bytes.byteLength }
  } finally {
    await page.close().catch(() => {})
  }
}
