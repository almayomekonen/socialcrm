import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { diagDb, type DiagCtx } from '../diag'

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

let lastDiagCtxForCrashHandler: DiagCtx | null = null
let globalCrashHandlersInstalled = false

function memSnapshot(): Record<string, number> {
  const m = process.memoryUsage()
  return {
    rssMB: Math.round(m.rss / 1024 / 1024),
    heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(m.heapTotal / 1024 / 1024),
    externalMB: Math.round(m.external / 1024 / 1024),
  }
}

function installGlobalCrashHandlers(): void {
  if (globalCrashHandlersInstalled) return
  globalCrashHandlersInstalled = true
  process.on('uncaughtException', (err) => {
    const ctx = lastDiagCtxForCrashHandler
    const payload = {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? '').slice(0, 600) : '',
    }
    console.error('[billing.pdf] process.uncaughtException', JSON.stringify(payload))
    if (ctx) void diagDb(ctx, 'process.uncaughtException', payload)
  })
  process.on('unhandledRejection', (reason) => {
    const ctx = lastDiagCtxForCrashHandler
    const msg = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? (reason.stack ?? '').slice(0, 600) : ''
    console.error('[billing.pdf] process.unhandledRejection', JSON.stringify({ error: msg, stack }))
    if (ctx) void diagDb(ctx, 'process.unhandledRejection', { error: msg, stack })
  })
}

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

async function detectLocalChromePath(ctx: DiagCtx | null): Promise<string | null> {
  await diagDb(ctx, 'detectLocalChromePath.enter')
  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      if (existsSync(candidate)) {
        await diagDb(ctx, 'detectLocalChromePath.hit', { candidate })
        return candidate
      }
    } catch {}
  }
  await diagDb(ctx, 'detectLocalChromePath.miss')
  return null
}

async function resolveExecutablePath(ctx: DiagCtx | null): Promise<{ path: string; source: string }> {
  await diagDb(ctx, 'resolveExecutablePath.enter')

  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim()
  if (envPath) {
    await diagDb(ctx, 'resolveExecutablePath.env_hit', { envPath })
    return { path: envPath, source: 'env' }
  }
  await diagDb(ctx, 'resolveExecutablePath.env_miss')

  const detected = await detectLocalChromePath(ctx)
  if (detected) {
    await diagDb(ctx, 'resolveExecutablePath.local_hit', { detected })
    return { path: detected, source: 'local' }
  }
  await diagDb(ctx, 'resolveExecutablePath.local_miss')

  log('chromium.extract.start')
  await diagDb(ctx, 'chromium.executablePath.before')
  let path: string
  try {
    path = await withTimeout(chromium.executablePath(), LAUNCH_TIMEOUT_MS, 'extract')
  } catch (err) {
    await diagDb(ctx, 'chromium.executablePath.error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  await diagDb(ctx, 'chromium.executablePath.after', { path })
  log('chromium.extract.done', { path })
  return { path, source: 'chromium-bundled' }
}

async function launchBrowser(ctx: DiagCtx | null): Promise<Browser> {
  installGlobalCrashHandlers()
  lastDiagCtxForCrashHandler = ctx

  await diagDb(ctx, 'launchBrowser.enter')
  const { path: executablePath, source } = await resolveExecutablePath(ctx)
  await diagDb(ctx, 'launchBrowser.executable_resolved', { executablePath, source })
  log('chromium.launch.start', { executablePath, source })

  const useLambdaArgs = source === 'chromium-bundled'
  const headlessMode: 'shell' | true = useLambdaArgs ? 'shell' : true
  const launchArgs = useLambdaArgs ? puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }) : LOCAL_ARGS
  const defaultViewport = useLambdaArgs ? { width: 1280, height: 1696 } : null

  await diagDb(ctx, 'puppeteer.launch.options', {
    useLambdaArgs,
    headless: headlessMode,
    argsCount: launchArgs.length,
    args: launchArgs,
    executablePath,
    defaultViewport,
    timeoutMs: LAUNCH_TIMEOUT_MS,
    mem: memSnapshot(),
    lambdaMemMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? null,
    region: process.env.AWS_REGION ?? null,
    nodeVersion: process.version,
  })

  let heartbeats = 0
  const heartbeat = setInterval(() => {
    heartbeats += 1
    void diagDb(ctx, 'puppeteer.launch.heartbeat', { tick: heartbeats, mem: memSnapshot() })
  }, 1000)

  await diagDb(ctx, 'puppeteer.launch.before', { useLambdaArgs, headless: headlessMode })

  let browser: Browser
  try {
    browser = await withTimeout(
      puppeteer.launch({
        args: launchArgs,
        defaultViewport,
        executablePath,
        headless: headlessMode,
        dumpio: true,
        protocolTimeout: LAUNCH_TIMEOUT_MS,
      }),
      LAUNCH_TIMEOUT_MS,
      'launch',
    )
  } catch (err) {
    clearInterval(heartbeat)
    await diagDb(ctx, 'puppeteer.launch.error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? '').slice(0, 600) : '',
      heartbeats,
      mem: memSnapshot(),
    })
    throw err
  }
  clearInterval(heartbeat)
  await diagDb(ctx, 'puppeteer.launch.after', { heartbeats, mem: memSnapshot() })
  log('chromium.launch.ok', { source })
  return browser
}

async function getBrowser(ctx: DiagCtx | null): Promise<Browser> {
  await diagDb(ctx, 'getBrowser.enter', { hasCachedPromise: !!browserPromise })
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.connected) {
        await diagDb(ctx, 'getBrowser.cache_hit')
        return existing
      }
      await diagDb(ctx, 'getBrowser.cache_disconnected')
    } catch {
      await diagDb(ctx, 'getBrowser.cache_rejected')
    }
    browserPromise = null
  }
  browserPromise = launchBrowser(ctx).catch((err) => {
    browserPromise = null
    throw err
  })
  await diagDb(ctx, 'getBrowser.awaiting_new_launch')
  const result = await browserPromise
  await diagDb(ctx, 'getBrowser.new_launch_ready')
  return result
}

export async function htmlToPdfBytes(html: string, ctx: DiagCtx | null = null): Promise<HtmlToPdfResult> {
  const t0 = Date.now()
  log('render.start', { htmlBytes: html.length })
  await diagDb(ctx, 'htmlToPdfBytes.enter', { htmlBytes: html.length })

  const browser = await getBrowser(ctx)
  await diagDb(ctx, 'htmlToPdfBytes.browser_ready')

  await diagDb(ctx, 'newPage.before')
  let page: Page
  try {
    page = await browser.newPage()
  } catch (err) {
    await diagDb(ctx, 'newPage.error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  await diagDb(ctx, 'newPage.after')

  try {
    await diagDb(ctx, 'setContent.before')
    try {
      await withTimeout(page.setContent(html, { waitUntil: 'domcontentloaded' }), RENDER_TIMEOUT_MS, 'setContent')
    } catch (err) {
      await diagDb(ctx, 'setContent.error', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    await diagDb(ctx, 'setContent.after')

    await diagDb(ctx, 'pagePdf.before')
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
      await diagDb(ctx, 'pagePdf.error', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    await diagDb(ctx, 'pagePdf.after', { byteLength: buffer.byteLength })

    const bytes = new Uint8Array(buffer)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    await diagDb(ctx, 'htmlToPdfBytes.success', { byteSize: bytes.byteLength, durationMs: Date.now() - t0 })
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
