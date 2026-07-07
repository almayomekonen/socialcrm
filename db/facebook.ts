import { db } from '@/config/db'

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
