import type { NextRequest } from 'next/server'

/**
 * Shared auth for /api/automation/* routes. n8n (not a logged-in user) calls
 * these, so they authenticate with a shared secret header rather than getUser().
 *
 * Secret precedence matches what the recovery-leads route already used:
 * AUTOMATION_API_KEY first, then CRON_SECRET as fallback.
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
