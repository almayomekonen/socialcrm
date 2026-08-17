/**
 * Post-enqueue IRE kick. `after()` / waitUntil continues after the HTTP 200,
 * but is still bounded by the invocation `maxDuration` (webhook/cron = 60s).
 * Do not export maxDuration from the promote `'use server'` module — Next.js
 * then drops the server-action exports and the production build fails.
 *
 * When delaySeconds > 0 the job's notBefore is in the future, so an immediate
 * claim returns 0. Sleep until approximately due, then run the existing worker
 * (claim still requires `notBefore <= now()`). Cap the wait so a large
 * delaySeconds (settings allow up to 3600) cannot exhaust the serverless budget;
 * `/api/cron/send-auto-responses` remains the drain/backstop.
 */
import { runAutoResponseWorker } from './worker'

export const IRE_KICK_MAX_WAIT_MS = 15_000
const IRE_KICK_BUFFER_MS = 250

export function ireKickWaitMs(delaySeconds: number): number {
  const d = Math.max(0, Math.floor(Number(delaySeconds) || 0))
  if (d <= 0) return 0
  return Math.min(d * 1000 + IRE_KICK_BUFFER_MS, IRE_KICK_MAX_WAIT_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type AutoResponseKickDeps = {
  sleep?: (ms: number) => Promise<void>
  run?: typeof runAutoResponseWorker
}

export async function runAutoResponseKick(
  opts: { delaySeconds?: number; limit?: number } = {},
  deps: AutoResponseKickDeps = {},
): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
  const waitMs = ireKickWaitMs(opts.delaySeconds ?? 0)
  if (waitMs > 0) await (deps.sleep ?? sleep)(waitMs)
  return (deps.run ?? runAutoResponseWorker)({ limit: opts.limit ?? 5 })
}
