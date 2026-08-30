import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { getPerms } from '@/db/filter'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { verifyMobileAccessToken } from './tokens'
import { bearerFrom, type MobileErrorCode } from './http'

/**
 * The mobile API's authentication boundary.
 *
 * This is the ONLY place a request becomes an identity. Every `/api/mobile/**`
 * handler starts here and then passes the resulting scope DOWN into the existing
 * service layer — the services are never asked to resolve who is calling, because
 * the way they do that (`getUser()` → `cookies()`) does not exist for a phone.
 *
 * WHAT THE TOKEN IS NOT TRUSTED FOR. The JWT proves only that we issued it and
 * that it has not expired. Whether the user still exists, is still unsuspended,
 * still belongs to an agency, and has not been revoked are all DATABASE facts,
 * re-read here on every single request. A token is a claim, not a permission.
 */

export type MobileUser = {
  id: number
  agencyId: number
  role: string
  name: string
  firstName: string | null
  /**
   * The row-visibility set the existing queries expect.
   *
   * `[]` means "no per-user restriction" (admins) — NOT "see nothing". Agency
   * scoping is always applied separately and is never optional.
   */
  gotPermIds: number[]
}

export class MobileAuthError extends Error {
  constructor(
    public code: MobileErrorCode,
    public status: number,
  ) {
    super(code)
    this.name = 'MobileAuthError'
  }
}

/**
 * Resolves the row-visibility set WITHOUT a session.
 *
 * `getPerms` is reused verbatim for non-admins because its permission logic —
 * direct grants, manager-team expansion, the `[0]` sentinel that means "nothing
 * matches" — is subtle enough that a second copy would drift from the web app and
 * silently disagree about who can see which lead.
 *
 * Admins are short-circuited because `getPerms` resolves them through
 * `getUsersAndTeams()` → `getAgencyId()` → `getUser()` → `cookies()`, which
 * throws in a bearer-authenticated request. That branch returns
 * `gotPermIds: []` and otherwise only builds assignment-dropdown data the API
 * does not serve, so nothing is lost by skipping it.
 */
async function resolveGotPermIds(user: { id: number; role: string; name: string }): Promise<number[]> {
  if (isAdmin(user.role as never)) return []
  const perms = await getPerms(user)
  return (perms?.gotPermIds ?? [0]) as number[]
}

/**
 * Authenticates a mobile request, or throws {@link MobileAuthError}.
 *
 * Deliberately mirrors `requireUser()`'s checks in the same order so the two
 * surfaces cannot disagree about who is allowed in — only the credential differs.
 */
export async function requireMobileUser(req: Request): Promise<MobileUser> {
  const token = bearerFrom(req)
  if (!token) throw new MobileAuthError('unauthorized', 401)

  const claims = await verifyMobileAccessToken(token)
  if (!claims) throw new MobileAuthError('unauthorized', 401)

  const row = await db('users')
    .where({ id: claims.userId })
    .first('id', 'agencyId', 'role', 'name', 'firstName', 'suspended', 'sessionVersion')

  // Deleted between mint and use.
  if (!row) throw new MobileAuthError('unauthorized', 401)

  /**
   * REVOCATION. The token carries the session version it was minted under; if the
   * user's current version has moved on, every credential from before the bump is
   * dead. This is what makes "sign out everywhere" real rather than advisory, and
   * it is checked here — not in the verifier — because it needs the database.
   */
  if (Number(row.sessionVersion ?? 0) !== claims.sessionVersion) {
    throw new MobileAuthError('unauthorized', 401)
  }

  if (row.suspended) throw new MobileAuthError('suspended', 403)
  if (typeof row.agencyId !== 'number') throw new MobileAuthError('no_agency', 403)

  const user = {
    id: Number(row.id),
    role: String(row.role),
    name: String(row.name ?? ''),
    firstName: row.firstName === null || row.firstName === undefined ? null : String(row.firstName),
    agencyId: Number(row.agencyId),
  }

  return { ...user, gotPermIds: await resolveGotPermIds(user) }
}

/**
 * {@link requireMobileUser} plus the product-access boundary.
 *
 * Layered exactly like `requireProductAccess` on the web: identity is unchanged,
 * and entitlement is derived server-side from the canonical trial state. The
 * client's claim about its own plan is never consulted.
 *
 * Use on product functionality only. Auth, `/me`, and activation must stay
 * reachable while access is denied — a rep whose trial lapsed still needs to sign
 * in and see WHY they are blocked.
 */
export async function requireMobileProductAccess(req: Request): Promise<MobileUser> {
  const user = await requireMobileUser(req)
  const { status, hasAccess } = await getAgencyProductAccess(user.agencyId)
  if (!hasAccess) {
    throw new MobileAuthError(
      status === 'NEVER_STARTED' ? 'trial_not_started' : 'subscription_required',
      403,
    )
  }
  return user
}
