import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'crypto'
import { db } from '@/config/db'
import { MAX_CODE_ATTEMPTS } from '@/lib/mobile/rateLimit'

/**
 * Six-digit email verification codes for the mobile passwordless sign-in.
 *
 * ⚠️ `randomInt`, NOT `Math.random()`. The repository already made this mistake
 * once and fixed it — `lib/funcs.ts#genToken` carries a comment about replacing
 * xorshift128+ output for exactly this class of secret. `crypto.randomInt` draws
 * from the CSPRNG and is free of the modulo bias that `% 1000000` introduces.
 *
 * ⚠️ ONLY A HASH IS STORED. A six-digit code is short enough to be shoulder-read
 * from a database dump and replayed; hashing means a reader of the table cannot
 * complete anyone's sign-in. It is unsalted SHA-256 on purpose: the value is
 * high-entropy-per-attempt only because of the attempt ceiling, and a salt would
 * prevent the constant-time lookup below without adding meaningful resistance to
 * an attacker who already has the row (they can brute 10^6 hashes trivially
 * either way — which is precisely why the ceiling, not the hash, is the control).
 */

/** Short — a code lives in a mailbox, not a session. */
export const CODE_TTL_MINUTES = 10

const DIGITS = 6

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Constant-time compare, so a mismatch cannot be located byte by byte. */
function hashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Uniform over 000000-999999. `randomInt` is unbiased; `%` would not be. */
function generateCode(): string {
  return String(randomInt(0, 10 ** DIGITS)).padStart(DIGITS, '0')
}

export type IssuedCode = { code: string; expiresAt: Date }

/**
 * Issues a fresh code for an email, invalidating any earlier live one.
 *
 * Superseding matters: without it, every unexpired code an attacker had ever
 * triggered would stay valid, multiplying the guess surface with each request.
 */
export async function issueEmailCode(email: string, ip: string): Promise<IssuedCode> {
  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  await db.transaction(async (trx) => {
    // Burn anything still outstanding for this address.
    await trx('mobile_auth_codes')
      .where({ email })
      .whereNull('consumed_at')
      .update({ consumed_at: trx.fn.now() })

    await trx('mobile_auth_codes').insert({
      email,
      code_hash: hashCode(code),
      expires_at: expiresAt,
      ip,
    })
  })

  return { code, expiresAt }
}

export type CodeCheck =
  | { ok: true }
  /** Every failure is one shape — the caller must not tell them apart to the client. */
  | { ok: false; reason: 'no_code' | 'expired' | 'mismatch' | 'too_many_attempts' }

/**
 * Verifies and CONSUMES a code.
 *
 * ⚠️ THE ROW IS LOCKED FOR THE WHOLE CHECK. Without `forUpdate`, two concurrent
 * guesses both read `attempts = 4`, both increment to 5, and the attacker gets a
 * free guess per parallel request — the ceiling would be advisory rather than
 * enforced.
 */
export async function verifyEmailCode(email: string, code: string): Promise<CodeCheck> {
  return await db.transaction(async (trx) => {
    const row = await trx('mobile_auth_codes')
      .where({ email })
      .whereNull('consumed_at')
      .orderBy('id', 'desc')
      .forUpdate()
      .first()

    if (!row) return { ok: false as const, reason: 'no_code' as const }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await trx('mobile_auth_codes').where({ id: row.id }).update({ consumed_at: trx.fn.now() })
      return { ok: false as const, reason: 'expired' as const }
    }

    if (Number(row.attempts) >= MAX_CODE_ATTEMPTS) {
      // Burn it: a code that has absorbed its budget must not linger.
      await trx('mobile_auth_codes').where({ id: row.id }).update({ consumed_at: trx.fn.now() })
      return { ok: false as const, reason: 'too_many_attempts' as const }
    }

    if (!hashEquals(String(row.code_hash), hashCode(code))) {
      await trx('mobile_auth_codes')
        .where({ id: row.id })
        .update({ attempts: Number(row.attempts) + 1 })
      return { ok: false as const, reason: 'mismatch' as const }
    }

    // SINGLE USE. Consumed inside the same locked transaction that matched it, so
    // two concurrent correct submissions cannot both mint a session.
    await trx('mobile_auth_codes').where({ id: row.id }).update({ consumed_at: trx.fn.now() })
    return { ok: true as const }
  })
}
