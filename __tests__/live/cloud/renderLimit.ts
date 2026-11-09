import { createHash } from 'node:crypto'
import { HarnessRefused } from '../quote/safety'

/**
 * Hard limits on what a run can ask of Browser Run, enforced at the fetch layer
 * so a retry counts too. Over a limit the request never leaves the machine and
 * every later one is refused. Pure apart from the `inner` it is given.
 *
 * A retry is a request whose body was already sent: one quote's HTML is the same
 * each time it is rendered.
 *
 * Workers Free allows one Browser Run request every 10 seconds and 10 browser
 * minutes a day. Every request, retries included, starts at least MIN_START_GAP_MS
 * after the one before it, in dry runs too, so a dry run proves the wiring.
 *
 * Browser time comes from X-Browser-Ms-Used, which Cloudflare documents as the
 * browser time used for that one request, in milliseconds, on every Quick Actions
 * response: the harness adds them up. When a response has no usable value the wall
 * clock of that request is charged instead. When there is no response at all the
 * browser may have run on, so Cloudflare's 60-second limit is charged.
 */

export type CloudLimits = { maxRenders: number; maxRetries: number }
export type RenderLimitState = {
  requests: number
  retries: number
  refused: number
  stopped: boolean
  stopReason: 'limit' | 'browser_budget' | null
  browserMs: number
  /** Responses whose browser time Cloudflare reported, and requests charged by estimate. */
  reportedResponses: number
  unmeasured: number
  minStartGapMs: number | null
  /** Resolves when a request could leave without waiting. For a test whose timeout must not run during pacing. */
  waitForSlot: () => Promise<void>
}
type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

/** 17 planned requests (one of them a planned retry), plus room for two rate-limit retries. */
export const LIMIT_CEILING: CloudLimits = { maxRenders: 20, maxRetries: 3 }
export const MIN_START_GAP_MS = 11_000
export const BROWSER_BUDGET_MS = 300_000
export const NO_RESPONSE_CHARGE_MS = 60_000

export function readCloudLimits(source: Record<string, string | undefined>, ceiling: CloudLimits = LIMIT_CEILING): CloudLimits {
  const read = (name: string, min: number, max: number) => {
    const raw = source[name]?.trim()
    if (!raw || !/^\d+$/.test(raw)) throw new HarnessRefused(`${name} is required and must be a whole number`)
    const n = Number(raw)
    if (n < min || n > max) throw new HarnessRefused(`${name} must be from ${min} to ${max}`)
    return n
  }
  const maxRenders = read('QUOTE_CLOUD_MAX_RENDERS', 1, ceiling.maxRenders)
  const maxRetries = read('QUOTE_CLOUD_MAX_RETRIES', 0, ceiling.maxRetries)
  if (maxRetries >= maxRenders) throw new HarnessRefused('QUOTE_CLOUD_MAX_RETRIES must be below QUOTE_CLOUD_MAX_RENDERS')
  return { maxRenders, maxRetries }
}

const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

/** Null unless the header holds a plain non-negative number. A successful render cannot have used no browser. */
function reportedBrowserMs(res: Response): number | null {
  const raw = res.headers.get('x-browser-ms-used')?.trim()
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null
  const ms = Number(raw)
  return !Number.isFinite(ms) || (res.ok && ms === 0) ? null : ms
}

export function createRenderLimiter(opts: { inner: typeof fetch; accountId: string; limits: CloudLimits; now?: () => number; sleep?: Sleep }) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/browser-run/pdf`
  const now = opts.now ?? (() => performance.now())
  const sleep = opts.sleep ?? abortableSleep
  let lastStart: number | null = null
  const gapLeft = () => (lastStart === null ? 0 : lastStart + MIN_START_GAP_MS - now())
  const state: RenderLimitState = {
    requests: 0,
    retries: 0,
    refused: 0,
    stopped: false,
    stopReason: null,
    browserMs: 0,
    reportedResponses: 0,
    unmeasured: 0,
    minStartGapMs: null,
    waitForSlot: async () => {
      for (let wait = gapLeft(); wait > 0 && !state.stopped; wait = gapLeft()) await sleep(wait)
    },
  }
  const seen = new Set<string>()

  const stop = (reason: 'limit' | 'browser_budget') => {
    state.stopped = true
    state.stopReason ??= reason
  }
  const charge = (ms: number) => {
    state.browserMs += ms
    if (state.browserMs >= BROWSER_BUDGET_MS) stop('browser_budget')
  }
  const refuseIfSpent = (isRetry: boolean) => {
    if (!state.stopped && state.requests < opts.limits.maxRenders && !(isRetry && state.retries >= opts.limits.maxRetries)) return
    stop('limit')
    state.refused++
    throw new HarnessRefused(state.stopReason === 'browser_budget' ? 'the browser-time budget for this run' : 'the render or retry limit for this run')
  }

  const limited = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'api.cloudflare.com') return opts.inner(input, init)
    if (`${url.origin}${url.pathname}` !== endpoint) {
      state.refused++
      throw new HarnessRefused('a Cloudflare API path other than the PDF endpoint')
    }
    const body = createHash('sha256').update(String(init?.body ?? '')).digest('hex')
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    // Checked on every pass, and nothing yields between the last pass and the start: concurrent callers cannot share a slot.
    for (;;) {
      signal?.throwIfAborted()
      refuseIfSpent(seen.has(body))
      const wait = gapLeft()
      if (wait <= 0) break
      await sleep(wait, signal)
    }

    const startedAt = now()
    if (lastStart !== null) state.minStartGapMs = Math.min(state.minStartGapMs ?? Infinity, startedAt - lastStart)
    lastStart = startedAt
    state.requests++
    if (seen.has(body)) state.retries++
    seen.add(body)

    let res: Response
    try {
      res = await opts.inner(input, init)
    } catch (err) {
      state.unmeasured++
      charge(NO_RESPONSE_CHARGE_MS)
      throw err
    }
    const reported = reportedBrowserMs(res)
    if (reported === null) state.unmeasured++
    else state.reportedResponses++
    charge(reported ?? Math.max(now() - startedAt, 0))
    return res
  }) as typeof fetch

  return { fetch: limited, state }
}

const SIGNED_URL = /https?:\/\/[^\s"'<>]*X-Amz-[^\s"'<>]*/g
const SIGNATURE_PARTS = /X-Amz-(Signature|Credential|Security-Token)=[^&\s"'<>]+/g

/** Takes signed links and known secret values out of a line of output. */
export function redactSensitive(text: string, secrets: readonly string[]): string {
  let out = text.replace(SIGNED_URL, '[signed-url]').replace(SIGNATURE_PARTS, 'X-Amz-$1=[redacted]')
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]')
  return out
}

export function installLogRedaction(secrets: readonly string[]): void {
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => original(...args.map((a) => (typeof a === 'string' ? redactSensitive(a, secrets) : a)))
  }
}
