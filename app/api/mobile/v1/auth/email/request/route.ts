import { NextResponse } from 'next/server'
import { getUserByEmail } from '@/db/auth'
import { issueEmailCode, CODE_TTL_MINUTES } from '@/db/mobileAuthCodes'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { renderEmail } from '@/lib/email/render'
import { sendEmail } from '@/lib/email/sender'
import MobileAuthCodeEmail from '@/emails/templates/MobileAuthCodeEmail'
import { clientIp, fail, noContent } from '@/lib/mobile/http'
import { isRateLimited, recordAttempts } from '@/lib/mobile/rateLimit'

/**
 * POST /api/mobile/v1/auth/email/request — send a six-digit sign-in code.
 *
 * ⚠️ ALWAYS 204, FOR EVERY EMAIL. Unknown address, suspended account, send
 * failure — the response is identical. Anything else turns this into an account
 * enumeration oracle: an attacker with a list of addresses could learn which are
 * SocialCRM customers by watching status codes. The web's `sendToken` reaches
 * the same conclusion in its own comment ("the response is uniform so this gate
 * does not itself leak account existence"), and this mirrors it deliberately.
 *
 * ⚠️ NO ACCOUNT IS EVER CREATED HERE. An unknown address silently does nothing.
 * Registration is a separate, explicit endpoint that provisions a tenant.
 *
 * ⚠️ RATE LIMITED ON TWO AXES. Per-email stops mailbox flooding of one person;
 * per-IP stops one host walking many addresses. A limited caller still receives
 * 204 — telling them they are throttled is itself a signal.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return fail('invalid_request', 400)
  }

  const body = parsed as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_request', 400)
  }

  // Strict allow-list: the only accepted key is the address.
  if (Object.keys(body).filter((k) => k !== 'email').length > 0) {
    return fail('invalid_request', 400)
  }

  const raw = body.email
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 320) {
    return fail('invalid_request', 400)
  }

  const email = normalizeEmail(raw)
  // A malformed address is a client bug, not an enumeration risk — it identifies
  // no account either way.
  if (!email.includes('@')) return fail('invalid_request', 400)

  const ip = clientIp(req)

  try {
    if (await isRateLimited('email_request', email, ip)) {
      // Silent: indistinguishable from a delivered code.
      return noContent()
    }
    await recordAttempts('email_request', email, ip)

    /**
     * Only a real, active account gets a code. This gate is the same one
     * `sendToken` applies, and it exists because without it the endpoint is an
     * open relay that emails arbitrary recipients from our domain.
     */
    const user = await getUserByEmail(email)
    if (!user || user.suspended) {
      console.log('[mobile/auth/email/request] no deliverable account — no-op')
      return noContent()
    }

    const { code } = await issueEmailCode(email, ip)

    const html = await renderEmail(
      MobileAuthCodeEmail({ code, expiresInMinutes: CODE_TTL_MINUTES }),
    )
    const result = await sendEmail({
      to: email,
      subject: 'קוד ההתחברות שלך ל-SocialCRM',
      html,
    })

    if (!result.ok) {
      // Logged without the code. The client still sees 204 — a send failure is
      // not something an anonymous caller gets to learn.
      console.error('[mobile/auth/email/request] send failed')
    }

    return noContent()
  } catch (err) {
    console.error('[mobile/auth/email/request] failed', { reason: (err as Error)?.message })
    // Even here: no detail, and the same shape as success.
    return noContent()
  }
}
