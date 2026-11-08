import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import net from 'node:net'

/**
 * What must be true before the live harnesses touch anything, and the walls
 * around them while they run. Local test database only; nothing leaves this
 * machine except requests to the one host a run is allowed to reach.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

export class HarnessRefused extends Error {
  constructor(reason: string) {
    super(`[live harness] refused: ${reason}`)
    this.name = 'HarnessRefused'
  }
}

/** Runs BEFORE the schema is rebuilt: that rebuild drops the whole database it is pointed at. */
export function assertSafeToRun(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'test') throw new HarnessRefused('NODE_ENV must be test')
  if (env.VERCEL || env.CI) throw new HarnessRefused('not on Vercel or CI')
  const raw = env.DATABASE_URL ?? ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HarnessRefused('DATABASE_URL is not a URL')
  }
  if (!LOOPBACK.has(url.hostname)) throw new HarnessRefused('the database is not on this machine')
  if (!url.pathname.slice(1).endsWith('_test')) throw new HarnessRefused('the database name does not end in _test')
}

/** A key file must be private and git-ignored. Returns its KEY=value pairs. */
export function readPrivateEnvFile(path: string, deps: { ignored?: (p: string) => boolean } = {}): Record<string, string> {
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077) throw new HarnessRefused(`${path} must be chmod 600`)
  const ignored =
    deps.ignored ??
    ((p: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', p])
        return true
      } catch {
        return false
      }
    })
  if (!ignored(path)) throw new HarnessRefused(`${path} must be git-ignored`)
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const SECRET_LIKE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL_UNPOOLED|_DATABASE_URL$/

/** Removes every secret-looking variable a shell or env file carried. `keep` survives. */
export function scrubSecrets(env: Record<string, string | undefined>, keep: readonly string[]): string[] {
  const removed: string[] = []
  for (const k of Object.keys(env)) {
    if (SECRET_LIKE.test(k) && !keep.includes(k)) {
      delete env[k]
      removed.push(k)
    }
  }
  return removed
}

export function assertRealBucket(file: Record<string, string>): void {
  const bucket = file.R2_BUCKET_NAME ?? ''
  if (!/(^|[-_.])test([-_.]|$)/i.test(bucket)) throw new HarnessRefused('R2_BUCKET_NAME must be visibly a test bucket')
  if (file.QUOTE_CLOUD_CONFIRM_BUCKET !== bucket) throw new HarnessRefused('QUOTE_CLOUD_CONFIRM_BUCKET must repeat the bucket name')
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_BROWSER_RENDERING_API_TOKEN']) if (!file[k]) throw new HarnessRefused(`${k} is required`)
}

export type NetworkGuard = { refusals: string[]; uninstall: () => void }

const hostOf = (input: unknown): string => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: string })?.url
  try {
    return new URL(String(raw)).hostname
  } catch {
    return String(raw)
  }
}

/**
 * Refuses every fetch and socket that is not loopback or an allowed host, and
 * records it: any refusal fails the run. `inner` replaces the real fetch for
 * allowed hosts in a run with no real provider.
 */
export function installNetworkGuard(opts: { allowedHosts: readonly string[]; inner?: typeof fetch }): NetworkGuard {
  const refusals: string[] = []
  const allowed = (host: string) => LOOPBACK.has(host) || opts.allowedHosts.includes(host)
  const realFetch = globalThis.fetch
  const realConnect = net.Socket.prototype.connect

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input)
    if (!allowed(host)) {
      refusals.push(`fetch:${host}`)
      return Promise.reject(new HarnessRefused(`network to ${host}`))
    }
    return (opts.inner ?? realFetch)(input, init)
  }) as typeof fetch

  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = (Array.isArray(args[0]) ? args[0][0] : args[0]) as { path?: string; host?: string } | number | string
    const isUnix = typeof first === 'string' || (typeof first === 'object' && first !== null && Boolean(first.path))
    if (!isUnix) {
      const host = typeof first === 'object' && first !== null ? (first.host ?? 'localhost') : typeof args[1] === 'string' ? args[1] : 'localhost'
      if (!allowed(host)) {
        refusals.push(`socket:${host}`)
        throw new HarnessRefused(`socket to ${host}`)
      }
    }
    return realConnect.apply(this, args as never)
  } as typeof net.Socket.prototype.connect

  return {
    refusals,
    uninstall: () => {
      globalThis.fetch = realFetch
      net.Socket.prototype.connect = realConnect
    },
  }
}
