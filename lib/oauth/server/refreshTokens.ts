import 'server-only'
import type { Knex } from 'knex'
import { randomUUID } from 'node:crypto'
import { db } from '@/config/db'
import { randomToken, sha256Hex } from './hash'
import { revokeGrant, type RevokeReason } from './grants'

/**
 * Rotating refresh tokens — same model as lib/mobile/tokens.ts: opaque 32
 * bytes, only SHA-256 stored, one family_id per code exchange, every use mints a
 * successor and stamps used_at on the old row.
 */

export const REFRESH_TTL_DAYS = 30

export type IssuedRefresh = { token: string; familyId: string; expiresAt: Date }

export async function issueRefreshToken(
  input: { grantId: number; userId: number; scopes: string[]; familyId?: string },
  conn: Knex | Knex.Transaction = db,
): Promise<IssuedRefresh> {
  const token = randomToken(32)
  const familyId = input.familyId ?? randomUUID()
  const [row] = await conn('oauth_refresh_tokens')
    .insert({
      grant_id: input.grantId,
      user_id: input.userId,
      family_id: familyId,
      token_hash: sha256Hex(token),
      scopes: input.scopes,
      // Hours, not days: a `days` interval on timestamptz is calendar-aware in the
      // session time zone and silently gains or loses an hour across DST.
      expires_at: conn.raw('NOW() + make_interval(hours => ?)', [REFRESH_TTL_DAYS * 24]),
    })
    .returning(['expires_at'])
  return { token, familyId, expiresAt: row.expires_at as Date }
}

async function revokeFamily(familyId: string, reason: RevokeReason, t: Knex.Transaction): Promise<void> {
  await t('oauth_refresh_tokens')
    .where({ family_id: familyId })
    .whereNull('revoked_at')
    .update({ revoked_at: t.fn.now(), revoked_reason: reason })
}

export type RotateOutcome =
  | { ok: true; token: string; familyId: string; grantId: number; userId: number; scopes: string[] }
  | { ok: false; reason: 'invalid' | 'expired' | 'reuse' | 'revoked' | 'invalid_scope' | 'invalid_target' }

/**
 * Rotation in ONE transaction with the presented token's row locked FOR UPDATE.
 *
 * Concurrent presentations of the same token serialise on that lock. The first
 * marks it used and inserts the successor; the second, once the lock is
 * released, re-reads the committed row (READ COMMITTED re-check under FOR
 * UPDATE), sees used_at, and is treated as replay: the WHOLE family and the
 * grant are revoked — including the first request's fresh successor.
 *
 * Every branch RETURNS rather than throws, so the revocation commits.
 * Deliberately not softened for clients that refresh in parallel (no grace
 * window); a scope or resource rejection leaves the token unused.
 */
export async function rotateRefreshToken(
  raw: string,
  check: { resource: string; requestedScopes?: string[] },
): Promise<RotateOutcome> {
  return db.transaction(async (t) => {
    const row = await t('oauth_refresh_tokens')
      .where({ token_hash: sha256Hex(raw) })
      .forUpdate()
      .first(
        'id',
        'grant_id',
        'user_id',
        'family_id',
        'scopes',
        'used_at',
        'revoked_at',
        t.raw('(expires_at < NOW()) AS expired'),
      )
    if (!row) return { ok: false, reason: 'invalid' } as const

    const grantId = Number(row.grant_id)
    if (row.used_at) {
      await revokeFamily(row.family_id, 'refresh_reuse', t)
      await revokeGrant(grantId, 'refresh_reuse', t)
      return { ok: false, reason: 'reuse' } as const
    }
    if (row.revoked_at) return { ok: false, reason: 'revoked' } as const
    if (row.expired) return { ok: false, reason: 'expired' } as const

    const grant = await t('oauth_grants').where({ id: grantId }).first('resource', 'revoked_at')
    if (!grant || grant.revoked_at) return { ok: false, reason: 'revoked' } as const
    if (check.resource !== grant.resource) return { ok: false, reason: 'invalid_target' } as const

    const granted = row.scopes as string[]
    const scopes = check.requestedScopes?.length ? Array.from(new Set(check.requestedScopes)) : granted
    if (!scopes.every((s) => granted.includes(s))) return { ok: false, reason: 'invalid_scope' } as const

    await t('oauth_refresh_tokens').where({ id: row.id }).update({ used_at: t.fn.now() })
    const next = await issueRefreshToken({ grantId, userId: row.user_id, scopes, familyId: row.family_id }, t)
    return { ok: true, token: next.token, familyId: row.family_id, grantId, userId: row.user_id, scopes } as const
  })
}

/** RFC 7009: revoke the lineage of a presented refresh token; unknown tokens are a no-op. */
export async function revokeRefreshFamilyByToken(raw: string): Promise<void> {
  await db.transaction(async (t) => {
    const row = await t('oauth_refresh_tokens')
      .where({ token_hash: sha256Hex(raw) })
      .first('family_id')
    if (row) await revokeFamily(row.family_id, 'client_revoked', t)
  })
}
