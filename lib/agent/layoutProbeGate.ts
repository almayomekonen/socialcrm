import { isPlatformOwner } from '@/lib/auth/platformOwner'

/**
 * TEMPORARY — whether /agent renders the real-device layout probe.
 *
 * Both conditions, always: the explicit `?agentdebug=1` parameter AND a platform
 * owner (the deny-by-default email allowlist used for cross-tenant admin). A
 * customer who adds the parameter gets the normal page; an owner who does not
 * add it gets the normal page.
 */
export function layoutProbeRequested(
  params: Record<string, string | string[] | undefined>,
  email: string | null | undefined,
): boolean {
  return params.agentdebug === '1' && isPlatformOwner(email)
}
