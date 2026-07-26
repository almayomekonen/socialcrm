import { db } from '@/config/db'
import { checkMessagingReady, checkAppSubscribed } from '@/lib/whatsapp/registration'

/**
 * Truthful WhatsApp connection status for the settings UI.
 *
 * The presence of a `whatsapp_connections` row is NOT sufficient to claim the
 * integration is operational — the audited incident (agency 69) had a persisted
 * row whose `subscribed_apps` had failed, so no message could ever arrive.
 *
 *  - 'operational'        we have real evidence leads/messages can arrive:
 *                         either proven inbound history, or a live-verified app
 *                         subscription + a messaging-ready number.
 *  - 'not_ready'          verified subscribed, but the number isn't registered
 *                         for send/receive yet (a known, explainable next step).
 *  - 'needs_verification' a row exists but we cannot PROVE it is operational
 *                         (e.g. a legacy row with no WABA id to check against).
 *                         We must not render this as "leads arrive automatically".
 *
 * No health cron is introduced — this is an on-demand check at settings render,
 * mirroring the existing `checkMessagingReady` call. Proven-inbound short-circuits
 * before any Graph call, so an established connection (agency 103) stays cheap.
 */
export type WhatsappStatus = 'operational' | 'not_ready' | 'needs_verification'

export type WaConnectionRow = {
  phone_number_id: string
  access_token: string
  waba_id: string | null
}

export async function resolveWhatsappStatus(conn: WaConnectionRow, agencyId: number): Promise<WhatsappStatus> {
  // 1. Strongest, cheapest evidence: a real inbound message was already received
  //    for this agency. Proves the whole path works. Covers established users.
  try {
    const inbound = await db('inbox_messages').where({ agencyId, direction: 'inbound' }).first()
    if (inbound) return 'operational'
  } catch {
    // fall through to live checks
  }

  // 2. Legacy row with no WABA id: we cannot verify the app subscription, so we
  //    cannot honestly claim it is operational. (Oren's 2026-07-21 row.)
  if (!conn.waba_id) return 'needs_verification'

  // 3. Live verify subscription + readiness.
  const [subscribed, ready] = await Promise.all([
    checkAppSubscribed(conn.waba_id, conn.access_token),
    checkMessagingReady(conn.phone_number_id, conn.access_token),
  ])
  if (!subscribed) return 'needs_verification'
  return ready ? 'operational' : 'not_ready'
}
