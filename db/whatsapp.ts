import { db } from '@/config/db'

/**
 * UI-side WhatsApp connection state for a user. Mirrors getFacebookConnectionState
 * (db/facebook.ts): a single shared read of the existing whatsapp_connections row
 * — no new detection, no live check. Used to decide whether the leads empty state
 * should still offer "Connect WhatsApp".
 */
export async function getWhatsappConnectionState(
  userId: number,
): Promise<{ connected: boolean }> {
  const connection = await db('whatsapp_connections').where({ user_id: userId }).first()
  return { connected: !!connection }
}
