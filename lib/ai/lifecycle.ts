import { after } from 'next/server'

/**
 * Hand a promise to the request lifecycle (Next `after()`): inside a request —
 * route handler, server action, cron route — the platform keeps the function
 * alive until it settles (Vercel `waitUntil`), bounded by the route's
 * maxDuration. 'detached' = no request scope (scripts, tests): nothing extends
 * the process, so the caller's own recovery path applies. Never throws.
 */
export function keepAliveUntilDone(work: Promise<unknown>): 'after' | 'detached' {
  try {
    after(work)
    return 'after'
  } catch {
    return 'detached'
  }
}
