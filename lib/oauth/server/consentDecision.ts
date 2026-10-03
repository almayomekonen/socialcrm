import 'server-only'
import { db } from '@/config/db'
import { secretEquals } from '@/lib/mobile/tokens'
import { verifyPendingRequest } from './pendingRequest'
import { checkConsentEligibility } from './consentEligibility'
import { upsertActiveGrant } from './grants'
import { issueAuthorizationCode } from './authorizationCodes'
import { buildAuthorizationRedirect } from './authorizeResponse'

/**
 * The consent decision, independent of HTTP plumbing.
 *
 * Source of truth is the signed pending request — never browser parameters —
 * plus the CURRENT session user, whose facts are re-read from the database.
 * A redirect is only ever to the redirect_uri inside a verified pending request;
 * every other failure is a local error.
 *
 * Single use: request_jti is checked up front for a clean message, and the
 * UNIQUE(request_jti) constraint is the final guard against concurrent
 * approvals — the loser's transaction (grant merge + code) rolls back.
 */

export type ConsentOutcome =
  | { kind: 'redirect'; location: string; clearPending: true }
  | { kind: 'error'; status: 400 | 401 | 500; message: string; clearPending: boolean }

export const CONSENT_EXPIRED = 'בקשת החיבור פגה או כבר טופלה. חזור ל-ChatGPT ונסה שוב.'
const BAD_REQUEST = 'הבקשה לא תקינה. חזור ל-ChatGPT ונסה שוב.'
const LOGIN_REQUIRED = 'יש להתחבר ל-SocialCRM כדי לאשר את החיבור.'

export async function isPendingRequestUsed(jti: string): Promise<boolean> {
  return !!(await db('oauth_authorization_codes').where({ request_jti: jti }).first('id'))
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505'

export async function decideConsent(input: {
  sessionUserId: number | null
  pendingRaw: string | undefined
  csrf: unknown
  decision: unknown
}): Promise<ConsentOutcome> {
  const pending = await verifyPendingRequest(input.pendingRaw)
  if (!pending) return { kind: 'error', status: 400, message: CONSENT_EXPIRED, clearPending: !!input.pendingRaw }

  // Keep the pending request: the user can still sign in and resume.
  if (!input.sessionUserId) return { kind: 'error', status: 401, message: LOGIN_REQUIRED, clearPending: false }

  // Not cleared on CSRF/decision failures: a forged cross-site post must not be
  // able to wipe the victim's legitimate pending request.
  if (typeof input.csrf !== 'string' || !secretEquals(input.csrf, pending.csrf)) {
    return { kind: 'error', status: 400, message: BAD_REQUEST, clearPending: false }
  }
  if (input.decision !== 'approve' && input.decision !== 'deny') {
    return { kind: 'error', status: 400, message: BAD_REQUEST, clearPending: false }
  }

  if (await isPendingRequestUsed(pending.jti)) {
    return { kind: 'error', status: 400, message: CONSENT_EXPIRED, clearPending: true }
  }

  const deny = (description?: string): ConsentOutcome => ({
    kind: 'redirect',
    location: buildAuthorizationRedirect(pending.redirectUri, {
      error: 'access_denied',
      ...(description ? { error_description: description } : {}),
      state: pending.state,
    }),
    clearPending: true,
  })

  if (input.decision === 'deny') return deny('the user denied the request')

  const eligible = await checkConsentEligibility(input.sessionUserId)
  if (!eligible.ok) return deny()

  try {
    const code = await db.transaction(async (t) => {
      const grant = await upsertActiveGrant(
        {
          userId: eligible.user.id,
          agencyId: eligible.user.agencyId,
          clientId: pending.clientId,
          clientName: pending.clientName,
          resource: pending.resource,
          scopes: pending.scopes,
          sessionVersion: eligible.user.sessionVersion,
        },
        t,
      )
      return issueAuthorizationCode(
        {
          grantId: grant.id,
          requestJti: pending.jti,
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          codeChallenge: pending.codeChallenge,
          scopes: pending.scopes,
          resource: pending.resource,
        },
        t,
      )
    })
    return {
      kind: 'redirect',
      location: buildAuthorizationRedirect(pending.redirectUri, { code, state: pending.state }),
      clearPending: true,
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { kind: 'error', status: 400, message: CONSENT_EXPIRED, clearPending: true }
    console.error('[oauth/consent] approval failed', { reason: (e as Error)?.message })
    return {
      kind: 'redirect',
      location: buildAuthorizationRedirect(pending.redirectUri, { error: 'server_error', state: pending.state }),
      clearPending: true,
    }
  }
}
