import 'server-only'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import { randomToken, sha256Hex } from './hash'
import { verifyPkceS256 } from './pkce'
import { revokeGrant } from './grants'

/**
 * Authorization codes: short-lived, single-use, stored only as SHA-256.
 *
 * request_jti is UNIQUE, so one pending authorization request can mint at most
 * one code (issue throws on a reused jti — the caller's transaction then rolls
 * back the grant change too).
 */

export const CODE_TTL_SECONDS = 120

export type CodeInput = {
  grantId: number
  requestJti: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
  resource: string
}

/** Returns the raw code; it is never stored. */
export async function issueAuthorizationCode(input: CodeInput, conn: Knex | Knex.Transaction = db): Promise<string> {
  const raw = randomToken(32)
  await conn('oauth_authorization_codes').insert({
    code_hash: sha256Hex(raw),
    grant_id: input.grantId,
    request_jti: input.requestJti,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
    expires_at: conn.raw('NOW() + make_interval(secs => ?)', [CODE_TTL_SECONDS]),
  })
  return raw
}

export type CodeCheck = { clientId: string; redirectUri: string; resource: string; codeVerifier: string }
export type CodeOutcome =
  | { ok: true; grantId: number; scopes: string[]; resource: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed' | 'mismatch' }

/**
 * Atomic single use. One transaction, the code row locked FOR UPDATE:
 *   · already consumed → REPLAY: revoke the grant (OAuth 2.1 §4.1.3) and return.
 *   · otherwise it is burned (consumed_at) BEFORE any other check, so an expired
 *     or mismatched presentation can never be retried into a success.
 * Concurrent presentations serialise on the row lock; the second sees
 * consumed_at. Every branch RETURNS (never throws), so the burn and any
 * revocation commit. The reasons are internal — the token endpoint maps all of
 * them to one `invalid_grant`.
 */
export async function consumeAuthorizationCode(raw: string, check: CodeCheck): Promise<CodeOutcome> {
  return db.transaction(async (t) => {
    const row = await t('oauth_authorization_codes')
      .where({ code_hash: sha256Hex(raw) })
      .forUpdate()
      .first(
        'id',
        'grant_id',
        'client_id',
        'redirect_uri',
        'code_challenge',
        'scopes',
        'resource',
        'consumed_at',
        t.raw('(expires_at < NOW()) AS expired'),
      )
    if (!row) return { ok: false, reason: 'invalid' } as const

    const grantId = Number(row.grant_id)
    if (row.consumed_at) {
      await revokeGrant(grantId, 'code_replay', t)
      return { ok: false, reason: 'replayed' } as const
    }

    await t('oauth_authorization_codes').where({ id: row.id }).update({ consumed_at: t.fn.now() })
    if (row.expired) return { ok: false, reason: 'expired' } as const

    const grant = await t('oauth_grants').where({ id: grantId }).whereNull('revoked_at').first('id')
    if (!grant) return { ok: false, reason: 'invalid' } as const

    const matches =
      row.client_id === check.clientId &&
      row.redirect_uri === check.redirectUri &&
      row.resource === check.resource &&
      verifyPkceS256(check.codeVerifier, row.code_challenge)
    if (!matches) return { ok: false, reason: 'mismatch' } as const

    return { ok: true, grantId, scopes: row.scopes as string[], resource: row.resource as string } as const
  })
}
