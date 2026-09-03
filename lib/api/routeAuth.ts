import { AuthError, requireUser, type AuthenticatedAgencyUser } from '@/lib/requireUser'
import { isAdmin, type Roles } from '@/types/roles'

/**
 * Authorization for Route Handlers, composed from the primitives that already
 * exist rather than introducing a second auth model.
 *
 * WHY THIS EXISTS. The integration routes authenticated with the bare
 * `getUser()`, which resolves a session and stops — it does not consult
 * `suspended`, does not require an `agencyId`, and has never checked a role. So
 * suspending a user did not stop them reconfiguring the agency's integrations,
 * and any authenticated role could sever a lead source for the whole business.
 * `requireUser()` already performs the session/suspension/agency checks
 * correctly; these helpers put the route handlers behind it and add the role
 * test that was missing.
 *
 * WHAT THIS IS NOT. It is not the capability system. There is no registry, no
 * override map and no `can()` here — role is tested with the existing
 * `isAdmin()` predicate, exactly as the ~49 Server Actions already do. When the
 * capability layer lands, these two functions are where a route swaps
 * `isAdmin()` for a capability key, and nothing else about the route changes.
 *
 * A discriminated result rather than a thrown error or a ready-made Response:
 * these routes answer in three different shapes — a JSON 401/403 for the POST
 * endpoints, a redirect to /auth for an unauthenticated OAuth start, a redirect
 * back to settings for an authenticated-but-forbidden one. The caller owns the
 * response; this owns the decision.
 */

export type RouteAuthDenial = 'unauthenticated' | 'suspended' | 'no_agency' | 'forbidden'

/**
 * Both fields are present on both outcomes, rather than a discriminated union.
 *
 * The repository compiles with `strictNullChecks: false`, under which TypeScript
 * does not narrow a union by a boolean discriminant — `if (!auth.ok)` leaves
 * `auth` as the whole union and every access to `reason` is an error. A flat
 * shape is the form that actually type-checks here. `ok` remains the only field
 * a caller should branch on.
 */
export type RouteAuthResult = {
  ok: boolean
  user: AuthenticatedAgencyUser | null
  reason: RouteAuthDenial | null
}

function deny(reason: RouteAuthDenial): RouteAuthResult {
  return { ok: false, user: null, reason }
}

function denialFor(err: unknown): RouteAuthDenial {
  if (err instanceof AuthError) {
    if (err.reason === 'suspended') return 'suspended'
    if (err.reason === 'no_agency') return 'no_agency'
  }
  return 'unauthenticated'
}

/**
 * An authenticated, non-suspended user belonging to an agency.
 *
 * The floor for every authenticated route. Use it where the operation is the
 * user's own — a personal Google connection, a status read — and a role test
 * would be wrong rather than merely absent.
 */
export async function requireActiveAgencyUser(): Promise<RouteAuthResult> {
  try {
    const user = await requireUser()
    if (typeof user.agencyId !== 'number') return deny('no_agency')
    return { ok: true, user: user as AuthenticatedAgencyUser, reason: null }
  } catch (err) {
    return deny(denialFor(err))
  }
}

/**
 * The same, plus an administrator of that agency.
 *
 * `isAdmin()` — ADMIN and GM — is deliberately the same predicate the Server
 * Actions use, so a route and an action never disagree about who is an admin.
 * Ordering matters: identity and suspension are settled before the role test,
 * so a suspended admin is refused as suspended rather than admitted as an admin.
 */
export async function requireAgencyAdmin(): Promise<RouteAuthResult> {
  const result = await requireActiveAgencyUser()
  if (!result.ok) return result
  if (!isAdmin(result.user.role as Roles)) return deny('forbidden')
  return result
}

/** HTTP status for a denial. Unauthenticated is 401; everything else is 403. */
export function statusFor(reason: RouteAuthDenial | null): 401 | 403 {
  return reason === 'unauthenticated' ? 401 : 403
}
