import 'server-only'
import { cookies } from 'next/headers'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { PENDING_COOKIE, verifyPendingRequest } from './pendingRequest'

/**
 * D1 — where a successful login lands.
 *
 * Exactly two possible answers, both fixed internal paths. The only
 * non-default one is chosen because a server-validated, unexpired pending
 * authorization exists. Nothing in the cookie (or the request) ever becomes a
 * URL, so there is no returnTo, no external or protocol-relative target.
 *
 * It only READS the pending cookie; it is cleared by the consent step (code
 * issued, or explicit denial), not by login.
 *
 * It never throws: any failure — MCP off, no cookie, bad or expired cookie,
 * unusable key, no request scope — means the original '/dashboard'. Credential
 * checks, session issuance and sessionVersion are untouched.
 */
export const OAUTH_CONSENT_PATH = '/oauth/consent' as const
export type PostLoginDestination = '/dashboard' | typeof OAUTH_CONSENT_PATH

export async function postLoginDestinationFromCookie(raw: string | null | undefined): Promise<PostLoginDestination> {
  try {
    if (!raw || !isMcpEnabled()) return '/dashboard'
    return (await verifyPendingRequest(raw)) ? OAUTH_CONSENT_PATH : '/dashboard'
  } catch {
    return '/dashboard'
  }
}

/** For server actions: reads the pending cookie from the current request. */
export async function postLoginDestination(): Promise<PostLoginDestination> {
  try {
    if (!isMcpEnabled()) return '/dashboard'
    const store = await cookies()
    return await postLoginDestinationFromCookie(store.get(PENDING_COOKIE)?.value)
  } catch {
    return '/dashboard'
  }
}
