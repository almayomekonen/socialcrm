import { cache } from 'react'
import { db } from '@/config/db'

/**
 * Developer plan-limit bypass — a centralized authorization override.
 *
 * Lets specific developer/owner accounts behave as if they were on the Pro plan
 * so the product can be tested without hitting free-plan viewing limits. This is
 * DELIBERATELY an authorization layer only:
 *
 *   - It NEVER mutates `agencies.plan` or any subscription/billing state.
 *   - It is scoped to an explicit email allowlist (deny-by-default), so no
 *     normal user is ever affected.
 *   - It is the single reusable primitive: any premium gate that resolves a plan
 *     can OR-in `isDevBypassAgency()` to grant Pro-equivalent access.
 *
 * Kept separate from `platformOwner.ts` on purpose: platform ownership gates
 * cross-tenant ADMIN surfaces, whereas this gates PLAN limits. Sharing one email
 * today does not mean the two concerns should move together.
 *
 * Configure via `DEV_BYPASS_EMAILS` (comma-separated). Falls back to the
 * founder's email so it works with zero config in development.
 */

const FALLBACK_DEV_EMAILS = ['alamayo274@gmail.com']

export function devBypassEmails(): string[] {
  const fromEnv = (process.env.DEV_BYPASS_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return fromEnv.length ? fromEnv : FALLBACK_DEV_EMAILS
}

/**
 * Agency ids owned by a dev-bypass email. Request-scoped memo (React `cache`):
 * resolved at most once per request, then reused by every plan check in that
 * request. One small indexed lookup; empty set when nothing matches (so the
 * common path for normal users is a cached no-op set membership test).
 */
export const getDevBypassAgencyIds = cache(async (): Promise<Set<number>> => {
  const emails = devBypassEmails()
  if (!emails.length) return new Set<number>()
  const placeholders = emails.map(() => '?').join(', ')
  const rows = await db('users').whereRaw(`lower("email") in (${placeholders})`, emails).select('agencyId')
  return new Set<number>(rows.map((r) => Number(r.agencyId)).filter((n) => Number.isFinite(n)))
})

/** True when this agency belongs to a dev-bypass account. */
export async function isDevBypassAgency(agencyId?: number | null): Promise<boolean> {
  if (!agencyId) return false
  return (await getDevBypassAgencyIds()).has(Number(agencyId))
}
