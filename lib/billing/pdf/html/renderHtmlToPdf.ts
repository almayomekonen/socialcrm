import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { diag } from '../diag'

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
  diag('detectLocalChromePath.enter')
  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      if (existsSync(candidate)) {
        diag('detectLocalChromePath.hit', { candidate })
        return candidate
      }
    } catch {
    }
  }
  diag('detectLocalChromePath.miss')
  return null
}

async function resolveExecutablePath(): Promise<{ path: string; source: string }> {
  diag('resolveExecutablePath.enter')

  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim()
  if (envPath) {
    diag('resolveExecutablePath.env_hit', { envPath })
    return { path: envPath, source: 'env' }
  }
  diag('resolveExecutablePath.env_miss')

  const detected = detectLocalChromePath()
  if (detected) {
    diag('resolveExecutablePath.local_hit', { detected })
    return { path: detected, source: 'local' }
  }
  diag('resolveExecutablePath.local_miss')

  log('chromium.extract.start')
  diag('chromium.executablePath.before')
  let path: string
  try {
    path = await withTimeout(chromium.executablePath(), LAUNCH_TIMEOUT_MS, 'extract')
  } catch (err) {
    diag('chromium.executablePath.error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  diag('chromium.executablePath.after', { path })
  log('chromium.extract.done', { path })
  return { path, source: 'chromium-bundled' }
}

async function launchBrowser(): Promise<Browser> {
  diag('launchBrowser.enter')
  const { path: executablePath, source } = await resolveExecutablePath()
  diag('launchBrowser.executable_resolved', { executablePath, source })
  log('chromium.launch.start', { executablePath, source })

  const useLambdaArgs = source === 'chromium-bundled'
  diag('puppeteer.launch.before', { useLambdaArgs })

  let browser: Browser
  try {
    browser = await withTimeout(
      puppeteer.launch({
        args: useLambdaArgs ? chromium.args : LOCAL_ARGS,
        defaultViewport: useLambdaArgs ? chromium.defaultViewport : null,
        executablePath,
        headless: true,
      }),
      LAUNCH_TIMEOUT_MS,
      'launch',
    )
  } catch (err) {
    diag('puppeteer.launch.error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  diag('puppeteer.launch.after')
  log('chromium.launch.ok', { source })
  return browser
}

async function getBrowser(): Promise<Browser> {
  diag('getBrowser.enter', { hasCachedPromise: !!browserPromise })
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.connected) {
        diag('getBrowser.cache_hit')
        return existing
      }
      diag('getBrowser.cache_disconnected')
    } catch {
      diag('getBrowser.cache_rejected')
    }
    browserPromise = null
  }
  browserPromise = launchBrowser().catch((err) => {
    diag('getBrowser.launch_chain_rejected', { error: err instanceof Error ? err.message : String(err) })
    browserPromise = null
    throw err
  })
  diag('getBrowser.awaiting_new_launch')
  const result = await browserPromise
  diag('getBrowser.new_launch_ready')
  return result
}

export async function htmlToPdfBytes(html: string): Promise<HtmlToPdfResult> {
  const t0 = Date.now()
  log('render.start', { htmlBytes: html.length })
  diag('htmlToPdfBytes.enter', { htmlBytes: html.length })

  const browser = await getBrowser()
  diag('htmlToPdfBytes.browser_ready')

  diag('newPage.before')
  let page: Page
  try {
    page = await browser.newPage()
  } catch (err) {
    diag('newPage.error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  diag('newPage.after')

  try {
    diag('setContent.before')
    try {
      await withTimeout(page.setContent(html, { waitUntil: 'domcontentloaded' }), RENDER_TIMEOUT_MS, 'setContent')
    } catch (err) {
      diag('setContent.error', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    diag('setContent.after')

    diag('pagePdf.before')
    let buffer: Uint8Array
    try {
      buffer = await withTimeout(
        page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
          preferCSSPageSize: true,
        }),
        RENDER_TIMEOUT_MS,
        'pdf',
      )
    } catch (err) {
      diag('pagePdf.error', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    diag('pagePdf.after', { byteLength: buffer.byteLength })

    const bytes = new Uint8Array(buffer)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    diag('htmlToPdfBytes.success', { byteSize: bytes.byteLength, durationMs: Date.now() - t0 })
    log('render.ok', { byteSize: bytes.byteLength, durationMs: Date.now() - t0 })
    return { bytes, contentHash, byteSize: bytes.byteLength }
  } catch (err) {
    log('render.fail', {
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    await page.close().catch(() => {})
  }
}
