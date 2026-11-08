import { createHash } from 'node:crypto'
import { HarnessRefused } from '../quote/safety'

/**
 * Hard limits on what a run can ask of Browser Run, enforced at the fetch layer
 * so a retry counts too. Over a limit the request never leaves the machine and
 * every later one is refused. Pure apart from the `inner` it is given.
 *
 * A retry is a request whose body was already sent: one quote's HTML is the same
 * each time it is rendered.
 */

export type CloudLimits = { maxRenders: number; maxRetries: number }
export type RenderLimitState = { requests: number; retries: number; refused: number; stopped: boolean }

/** 17 planned requests (one of them a planned retry), plus room for two rate-limit retries. */
export const LIMIT_CEILING: CloudLimits = { maxRenders: 20, maxRetries: 3 }

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

export function createRenderLimiter(opts: { inner: typeof fetch; accountId: string; limits: CloudLimits }) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/browser-run/pdf`
  const state: RenderLimitState = { requests: 0, retries: 0, refused: 0, stopped: false }
  const seen = new Set<string>()

  const limited = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.hostname !== 'api.cloudflare.com') return opts.inner(input, init)
    if (`${url.origin}${url.pathname}` !== endpoint) {
      state.refused++
      throw new HarnessRefused('a Cloudflare API path other than the PDF endpoint')
    }
    const body = createHash('sha256').update(String(init?.body ?? '')).digest('hex')
    const isRetry = seen.has(body)
    if (state.stopped || state.requests >= opts.limits.maxRenders || (isRetry && state.retries >= opts.limits.maxRetries)) {
      state.stopped = true
      state.refused++
      throw new HarnessRefused('the render or retry limit for this run')
    }
    state.requests++
    if (isRetry) state.retries++
    seen.add(body)
    return opts.inner(input, init)
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
