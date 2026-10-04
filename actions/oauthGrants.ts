'use server'

import { revalidatePath } from 'next/cache'
import { AuthError, requireUser } from '@/lib/requireUser'
import { revokeGrantForUser } from '@/lib/oauth/server/grants'

export type DisconnectAiConnectionResult = { ok: true } | { ok: false; msg: string }

const NOT_FOUND = 'החיבור לא נמצא. רענן את הדף ונסה שוב.'

/**
 * Settings → disconnect one AI connection (Claude, ChatGPT, …).
 *
 * Identity is the session user — never an id from the request. The grant id
 * from the UI is only a handle: revokeGrantForUser revokes it only if it
 * belongs to this user and agency (another user's grant is the same
 * "not found"). Revoking the GRANT revokes all its refresh tokens, and because
 * every MCP request re-checks the grant, already-issued access tokens stop
 * working on their next call. Other connections are untouched. Idempotent: an
 * already-disconnected grant keeps its original reason and time.
 */
export async function disconnectAiConnection(grantId: unknown): Promise<DisconnectAiConnectionResult> {
  let user
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, msg: 'ההתחברות פגה. התחבר מחדש ונסה שוב.' }
    throw err
  }
  if (typeof grantId !== 'number' || !Number.isSafeInteger(grantId) || grantId <= 0) return { ok: false, msg: NOT_FOUND }

  const outcome = await revokeGrantForUser(Number(user.id), Number(user.agencyId), grantId, 'user_disconnect')
  // Security trail: who disconnected what, never a token. The grant row keeps
  // revoked_reason = user_disconnect and revoked_at.
  console.log(`[oauth] user_disconnect userId=${user.id} grantId=${grantId} outcome=${outcome}`)
  if (outcome === 'not_found') return { ok: false, msg: NOT_FOUND }

  revalidatePath('/settings/integrations')
  return { ok: true }
}
