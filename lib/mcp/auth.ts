import 'server-only'
import { db } from '@/config/db'
import { getPerms } from '@/db/filter'
import { isAdmin, type Roles } from '@/types/roles'
import { getEffectiveLeadPlan } from '@/lib/quota'
import { getFirstName } from '@/lib/users/displayName'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { isMcpEnabled, canUseMcp } from '@/lib/flags/mcpFlags'
import { verifyMcpAccessToken } from '@/lib/oauth/server/accessToken'
import { revokeGrant, touchGrant, type RevokeReason } from '@/lib/oauth/server/grants'
import { mcpResource } from '@/lib/oauth/server/config'
import type { AuditIdentity, McpPrincipal } from './scope'

/**
 * The MCP authentication boundary. A valid JWT is necessary, never sufficient:
 * on EVERY request the grant, the user, the rollout and product access are
 * re-read from the database, so an unexpired token stops working on the very
 * next request after any of them changes. No token denylist is needed.
 *
 *   missing / invalid → HTTP 401 at the route (Task 12)
 *   disabled          → 404 (MCP kill switch)
 *   feature_not_enabled / product_access_required → structured tool errors
 *     (authenticated, so they carry an audit identity)
 *
 * The bearer token is never logged.
 */
export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; kind: 'missing' | 'invalid' | 'disabled' }
  | { ok: false; kind: 'feature_not_enabled'; identity: AuditIdentity }
  | { ok: false; kind: 'product_access_required'; reason: 'trial_not_started' | 'subscription_required'; identity: AuditIdentity }

// RFC 6750 b64token after exactly one space; anything else (commas, extra
// spaces, other schemes) is malformed.
const BEARER_RE = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i

type Row = {
  grantUserId: number
  grantAgencyId: number
  clientId: string
  resource: string
  scopes: string[]
  grantSv: number
  revokedAt: Date | null
  uid: number | null
  userAgencyId: number | null
  suspended: boolean | null
  userSv: number | null
  role: string | null
  name: string | null
  firstName: string | null
  lastName: string | null
}

async function revokeQuietly(grantId: number, reason: RevokeReason, requestId: string): Promise<void> {
  await revokeGrant(grantId, reason).catch((e) =>
    console.error('[mcp/auth] revoke failed', { requestId, reason, error: (e as Error)?.name }),
  )
}

export async function authenticateMcpRequest(req: Request, requestId: string): Promise<McpAuthResult> {
  if (!isMcpEnabled()) return { ok: false, kind: 'disabled' }

  // ── 1. Credential: Authorization header only (a query-string token is ignored).
  const header = req.headers.get('authorization')
  if (header === null) return { ok: false, kind: 'missing' }
  const m = BEARER_RE.exec(header)
  if (!m) return { ok: false, kind: 'invalid' }

  // ── 2. Token: signature, HS256, iss, aud, exp/nbf, typ, validated claims.
  const claims = await verifyMcpAccessToken(m[1])
  if (!claims) return { ok: false, kind: 'invalid' }

  // ── 3. Grant binding — the token must still describe this active grant exactly.
  const row = (await db('oauth_grants as g')
    .leftJoin('users as u', 'u.id', 'g.user_id')
    .where('g.id', claims.grantId)
    .first(
      'g.user_id as grantUserId',
      'g.agency_id as grantAgencyId',
      'g.client_id as clientId',
      'g.resource',
      'g.scopes',
      'g.session_version as grantSv',
      'g.revoked_at as revokedAt',
      'u.id as uid',
      'u.agencyId as userAgencyId',
      'u.suspended',
      'u.sessionVersion as userSv',
      'u.role',
      'u.name',
      'u.firstName',
      'u.lastName',
    )) as Row | undefined
  if (!row || row.revokedAt) return { ok: false, kind: 'invalid' }
  const bound =
    row.grantUserId === claims.userId &&
    row.grantAgencyId === claims.agencyId &&
    row.clientId === claims.clientId &&
    row.resource === mcpResource() &&
    row.grantSv === claims.sessionVersion &&
    claims.scopes.every((s) => row.scopes.includes(s))
  if (!bound) return { ok: false, kind: 'invalid' }

  // ── 4. Current account state. A change here ends the grant for good.
  const accountProblem: RevokeReason | null =
    row.uid === null
      ? 'user_missing'
      : row.suspended
        ? 'user_suspended'
        : row.userAgencyId !== row.grantAgencyId
          ? 'agency_changed'
          : Number(row.userSv ?? 0) !== claims.sessionVersion
            ? 'session_revoked'
            : null
  if (accountProblem) {
    await revokeQuietly(claims.grantId, accountProblem, requestId)
    return { ok: false, kind: 'invalid' }
  }

  const identity: AuditIdentity = {
    requestId,
    userId: claims.userId,
    agencyId: claims.agencyId,
    grantId: claims.grantId,
    clientId: claims.clientId,
  }

  // ── 5. Rollout (the grant is kept; the token endpoint revokes on refresh).
  if (!canUseMcp(claims.agencyId)) return { ok: false, kind: 'feature_not_enabled', identity }

  // ── 6. Product access — reported as such, never as an invalid token.
  const access = await getAgencyProductAccess(claims.agencyId)
  if (!access.hasAccess) {
    return {
      ok: false,
      kind: 'product_access_required',
      reason: access.status === 'NEVER_STARTED' ? 'trial_not_started' : 'subscription_required',
      identity,
    }
  }

  // ── 7. Principal. Permissions come from the product's own getPerms; admins
  //       short-circuit to [] exactly as lib/mobile/auth.ts does (getPerms'
  //       admin branch reads the web session, which a bearer request lacks).
  const role = String(row.role) as Roles
  const gotPermIds = isAdmin(role)
    ? []
    : (((await getPerms({ id: claims.userId, role, name: row.name ?? '' }))?.gotPermIds as number[] | undefined) ?? [0])
  const plan = await getEffectiveLeadPlan(claims.agencyId)

  await touchGrant(claims.grantId).catch((e) =>
    console.error('[mcp/auth] touch failed', { requestId, error: (e as Error)?.name }),
  )

  return {
    ok: true,
    principal: {
      requestId,
      userId: claims.userId,
      agencyId: claims.agencyId,
      role,
      firstName: getFirstName({ name: row.name, firstName: row.firstName, lastName: row.lastName }),
      gotPermIds,
      plan,
      grantId: claims.grantId,
      clientId: claims.clientId,
      scopes: claims.scopes,
    },
  }
}
