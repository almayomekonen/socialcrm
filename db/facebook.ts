import { db } from '@/config/db'
import { hasCommentTextCapability } from '@/lib/facebook/comments/capability'

/**
 * UI-side Meta (Facebook) connection state for a user. Single source of truth
 * for "is Meta connected / does it need reconnect" wherever the app UI needs to
 * reflect the real connection state (empty states, reconnect banner).
 *
 * Reuses the existing signals — no new detection logic and no Graph API call
 * (safe for page render):
 *   - `connected`      → a facebook_pages row exists for the user (same check as
 *                        MobileActivationGate / the settings page / status route).
 *   - `needsReconnect` → the health_status column is 'token_expired' (maintained
 *                        by the webhook and /api/facebook/status).
 */
export async function getFacebookConnectionState(
  userId: number,
): Promise<{ connected: boolean; needsReconnect: boolean }> {
  const connection = await db('facebook_pages').where({ user_id: userId }).first()
  if (!connection) return { connected: false, needsReconnect: false }
  return { connected: true, needsReconnect: connection.health_status === 'token_expired' }
}

/**
 * Normalize the persisted `granted_scopes` jsonb into permission names.
 *
 * TOTAL and fail-closed. The `pg` driver may hand back a parsed array or a JSON
 * string depending on the column type and driver path, and a row written before
 * the column existed carries the `'[]'` default — all three, plus null and
 * garbage, must collapse to "no scopes known" rather than throw on a render path.
 */
export function parseGrantedScopes(raw: unknown): string[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value.filter((s): s is string => typeof s === 'string' && s.length > 0)
}

/**
 * Can this agency's connected Page show comment TEXT?
 *
 * Two independent facts, both required, neither guessed:
 *   · a Page is connected for the agency, and
 *   · the grant recorded at connect time includes `pages_read_user_content`.
 *
 * Meta's gate only — our own rollout switch stays
 * `isFacebookCommentsEnabledForAgency`. Keeping them separate is what lets the
 * UI distinguish "not rolled out to you" from "reconnect to see comment text".
 *
 * `needsReconnect` is the actionable half: a Page connected before the scope was
 * requested cannot gain it in place, because an issued token never widens — the
 * user has to walk the OAuth dialog again.
 */
export async function getFacebookCommentTextCapability(
  agencyId: number,
): Promise<{ connected: boolean; granted: boolean; needsReconnect: boolean }> {
  if (!Number.isFinite(agencyId) || agencyId <= 0) {
    return { connected: false, granted: false, needsReconnect: false }
  }
  const connection = await db('facebook_pages')
    .where({ agency_id: agencyId })
    .first('granted_scopes')
  if (!connection) return { connected: false, granted: false, needsReconnect: false }

  const granted = hasCommentTextCapability(parseGrantedScopes(connection.granted_scopes))
  // Only a CONNECTED Page can be reconnected. Absent a connection the correct
  // prompt is "connect", which the settings page already owns.
  return { connected: true, granted, needsReconnect: !granted }
}
