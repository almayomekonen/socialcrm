import type { NextRequest } from 'next/server'

/**
 * Shared auth for automation / cron HTTP callers (n8n, schedulers, workers).
 * These are not logged-in users, so they authenticate with a shared secret
 * header rather than getUser().
 *
 * Secret precedence: AUTOMATION_API_KEY first, then CRON_SECRET as fallback.
 * Used today by cron workers (e.g. send-auto-responses); keep this helper for
 * future Automations module routes under the same auth model.
 */
export function getAutomationSecret(): string | undefined {
  return process.env.AUTOMATION_API_KEY ?? process.env.CRON_SECRET
}

export function isAutomationAuthorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization')
  if (auth && auth === `Bearer ${secret}`) return true
  if (req.headers.get('x-automation-key') === secret) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}
