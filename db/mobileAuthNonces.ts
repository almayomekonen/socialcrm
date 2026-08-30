import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/config/db'

/**
 * Server-minted login nonces for mobile Facebook Limited Login.
 *
 * ⚠️ THE NONCE IS THE ANTI-REPLAY CONTROL, not a secret in the usual sense. iOS
 * Facebook Login returns an OIDC token whose `nonce` claim echoes a value passed
 * at login time. Meta currently mints those tokens with a 90-day lifetime, so a
 * captured token is replayable for three months unless the server can prove the
 * token answers a challenge IT issued. That proof is this table.
 *
 * ⚠️ 256 BITS FROM THE CSPRNG. `mobileAuthCodes` needs an attempt ceiling because
 * a 6-digit code is walkable; this value is not, so the guard here is single-use
 * consumption plus a short TTL rather than a guess budget.
 *
 * ⚠️ ONLY A HASH IS PERSISTED, and the raw nonce is never logged. Unlike the code
 * path there is no constant-time compare: lookup is an exact match on the digest
 * through a unique index, and a 256-bit preimage cannot be recovered from it, so
 * there is nothing for a timing side channel to reveal.
 */

/**
 * Short by design. The nonce only has to survive one trip through the Facebook
 * dialog; anything longer widens the window in which a leaked nonce is useful.
 */
export const NONCE_TTL_MINUTES = 5

/** 32 bytes -> 64 hex chars. Hex, not base64url, so it is safe verbatim in the
 *  Facebook SDK's nonce field, which rejects whitespace and is happier without
 *  `+`/`/`/`=` travelling through URL and JSON layers. */
const NONCE_BYTES = 32

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

export type IssuedNonce = { nonce: string; expiresAt: Date }

/**
 * Mints a nonce and stores only its digest.
 *
 * Deliberately does NOT supersede earlier outstanding nonces the way
 * `issueEmailCode` does. Superseding matters there because every live code
 * multiplies the guess surface against one mailbox; here each nonce is
 * unguessable and single-use, and invalidating older ones would break a user who
 * has two sign-in attempts in flight (a backgrounded app, a retried tap).
 */
export async function issueLoginNonce(ip: string): Promise<IssuedNonce> {
  const nonce = randomBytes(NONCE_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60 * 1000)

  await db('mobile_auth_nonces').insert({
    nonce_hash: hashNonce(nonce),
    expires_at: expiresAt,
    ip,
  })

  return { nonce, expiresAt }
}

export type NonceCheck =
  | { ok: true }
  /** Callers must collapse these to one client-visible failure. */
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used' }

/**
 * Verifies and CONSUMES a nonce. Phase 2 calls this from the Limited Login
 * verifier; nothing consumes it yet.
 *
 * ⚠️ THE ROW IS LOCKED FOR THE WHOLE CHECK. Without `forUpdate`, two concurrent
 * requests carrying the same replayed token both read `consumed_at = null` and
 * both succeed — single-use would be advisory rather than enforced, which is the
 * entire property this table exists to provide.
 */
export async function consumeLoginNonce(nonce: string): Promise<NonceCheck> {
  const nonceHash = hashNonce(nonce)

  return await db.transaction(async (trx) => {
    const row = await trx('mobile_auth_nonces')
      .where({ nonce_hash: nonceHash })
      .forUpdate()
      .first()

    if (!row) return { ok: false as const, reason: 'unknown' as const }

    // Checked before expiry so a replay of a spent nonce is reported as a replay
    // rather than being masked as a timeout.
    if (row.consumed_at) return { ok: false as const, reason: 'already_used' as const }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      // Burn it: an expired nonce must not linger as a live row.
      await trx('mobile_auth_nonces').where({ id: row.id }).update({ consumed_at: trx.fn.now() })
      return { ok: false as const, reason: 'expired' as const }
    }

    await trx('mobile_auth_nonces').where({ id: row.id }).update({ consumed_at: trx.fn.now() })
    return { ok: true as const }
  })
}
