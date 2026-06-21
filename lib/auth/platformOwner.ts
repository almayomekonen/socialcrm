/**
 * Platform-owner gate for cross-tenant admin surfaces (e.g. /admin).
 *
 * This is DELIBERATELY separate from the agency role system (Roles.ADMIN/GM in
 * types/roles.ts): those roles are workspace-scoped, so an agency "admin" must
 * NEVER gain access to other agencies' data. Platform ownership is an
 * allowlist of specific emails — deny-by-default for everyone else.
 *
 * Configure via the PLATFORM_OWNER_EMAILS env var (comma-separated). If unset,
 * it falls back to the founder's email so the tool works with zero config.
 */

const FALLBACK_OWNERS = ['alamayo274@gmail.com']

export function platformOwnerEmails(): string[] {
  const fromEnv = (process.env.PLATFORM_OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return fromEnv.length ? fromEnv : FALLBACK_OWNERS
}

export function isPlatformOwner(email?: string | null): boolean {
  if (!email) return false
  return platformOwnerEmails().includes(email.trim().toLowerCase())
}
