import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { issueRefreshToken, signMobileAccessToken } from '@/lib/mobile/tokens'
import { clientIp, fail, ok } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/register — create a tenant and sign in on mobile.
 *
 * ⚠️ WHY THIS DOES NOT CALL `addAgency`. That action is `'use server'` and bound
 * to the web request: it calls `createCookie`, `readFacebookLoginProof` and
 * `isMobileRequest()` (all cookie/header readers), then `revalidatePath`,
 * `redirect` and `after()`. None of those exist for a bearer-authenticated
 * phone, and several throw outright. Refactoring `addAgency` to share a core
 * would mean changing the live web registration path purely to serve mobile —
 * which is explicitly out of scope.
 *
 * ⚠️ SO THE TRANSACTION IS MIRRORED, AND THAT DUPLICATION IS A LIABILITY. The
 * four inserts, their order, the ADMIN role, `onboardingCompletedAt`, and the
 * `23505` handling below are copied from `actions/agencies.ts#addAgency`. If that
 * function's tenant shape changes, THIS MUST CHANGE TOO. The alternative was
 * worse; the honest mitigation is to say so loudly here.
 *
 * ⚠️ ATOMIC OR NOTHING. agency → user → users_info → default_settings run in one
 * transaction. A half-provisioned tenant — an agency with no user, or a user with
 * no settings row — is far worse than a failed signup, because it is invisible
 * until someone tries to use it.
 *
 * ⚠️ NO FACEBOOK PROOF. `addAgency` optionally attaches `facebookSub` from a
 * cookie set during web Facebook login. There is no mobile Facebook flow yet, so
 * that path is deliberately absent rather than faked.
 */

type RegisterInput = {
  agencyName: string
  firstName: string
  lastName: string
  email: string
}

/** Mirrors the web form's fields exactly — no more, no fewer. */
function parseBody(body: Record<string, unknown>): RegisterInput | null {
  const allowed = ['agencyName', 'firstName', 'lastName', 'email']
  if (Object.keys(body).filter((k) => !allowed.includes(k)).length > 0) return null

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null
    const trimmed = v.trim()
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
  }

  const agencyName = str(body.agencyName, 200)
  const firstName = str(body.firstName, 100)
  const lastName = str(body.lastName, 100)
  const rawEmail = str(body.email, 320)
  if (!agencyName || !firstName || !lastName || !rawEmail) return null

  const email = normalizeEmail(rawEmail)
  if (!email.includes('@')) return null

  return { agencyName, firstName, lastName, email }
}

export async function POST(req: Request): Promise<NextResponse> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return fail('invalid_request', 400)
  }

  const raw = parsed as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_request', 400)

  const input = parseBody(raw)
  if (!input) return fail('invalid_request', 400)

  const ip = clientIp(req)

  if (await isRateLimited('register', input.email, ip)) {
    // Signup abuse creates real tenants and sends real mail — worth a hard stop.
    return fail('rate_limited', 429)
  }
  await recordAttempts('register', input.email, ip)

  let createdUserId: number | null = null

  try {
    await db.transaction(async (trx) => {
      const agency = await trx('agencies')
        .insert({ name: input.agencyName, onboardingCompletedAt: trx.fn.now() })
        .returning('id')
      const agencyId = agency[0]?.id

      const [user] = await trx('users')
        .insert({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          agencyId,
          // Matches the web: the first user of a new tenant owns it.
          role: 'ADMIN',
        })
        .returning('*')

      await trx('users_info').insert({ id: user.id }).onConflict('id').merge()
      await trx('default_settings').insert({ userId: user.id })

      createdUserId = Number(user.id)
    })
  } catch (err) {
    /**
     * Postgres unique violation. The web path distinguishes a duplicate Facebook
     * sub here; mobile has no Facebook registration, so the only reachable
     * duplicate is the email.
     */
    if ((err as { code?: string })?.code === '23505') {
      console.warn('[mobile/auth/register] duplicate email')
      return fail('invalid_request', 409, { reason: 'email_taken' })
    }
    console.error('[mobile/auth/register] failed', { reason: (err as Error)?.message })
    return fail('server_error', 500)
  }

  if (createdUserId === null) return fail('server_error', 500)

  try {
    /**
     * A MOBILE session, never `createCookie`. Same minting path as every other
     * mobile entry point: new refresh family, rotation and reuse detection apply
     * from here on.
     *
     * `emailVerifiedAt` is deliberately NOT set — registration proves nothing
     * about the mailbox. The first email code or Google sign-in sets it, and the
     * first-ownership revocation in those routes then does its job.
     */
    const issued = await issueRefreshToken(createdUserId, {
      userAgent: req.headers.get('user-agent'),
      ip,
      deviceId: req.headers.get('x-device-id'),
      deviceName: req.headers.get('x-device-name'),
      platform: req.headers.get('x-platform'),
    })

    console.log('[mobile/auth/register] tenant created', { userId: createdUserId })

    return ok(
      {
        accessToken: await signMobileAccessToken(createdUserId),
        refreshToken: issued.token,
      },
      { status: 201 },
    )
  } catch (err) {
    // The tenant exists but we could not mint. Report honestly rather than
    // rolling back an account the user can now sign into with a code.
    console.error('[mobile/auth/register] tenant created but session mint failed', {
      userId: createdUserId,
      reason: (err as Error)?.message,
    })
    return fail('server_error', 500)
  }
}
