import { NextRequest, NextResponse } from 'next/server'
import { requireActiveAgencyUser, statusFor } from '@/lib/api/routeAuth'
import { decryptSecret } from '@/lib/crypto/secrets'
import { deleteDriveConnectionByUserId, getDriveConnectionByUserId } from '@/db/googleDriveConnections'

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export async function POST(_req: NextRequest) {
  /**
   * A PERSONAL integration, and it stays personal.
   *
   * `google_drive_connections` is keyed by `user_id`: this revokes the caller's
   * own Google grant and nobody else's, so an admin role test would be wrong
   * here, not merely missing. What was missing is that `getUser()` never
   * consulted `suspended` — a suspended account could still act on its
   * connection. That is the whole of the change; the self scope below is
   * untouched.
   */
  const auth = await requireActiveAgencyUser()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user

  const connection = await getDriveConnectionByUserId(user.id)
  if (!connection) return NextResponse.json({ ok: true })

  // Best-effort revoke at Google; never block local deletion on failure.
  try {
    const refresh = decryptSecret(connection.refresh_token)
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
    if (!res.ok) {
      console.warn(`[GoogleDriveDisconnect] Revoke failed [userId=${user.id}]:`, await res.text())
    }
  } catch (err) {
    console.warn(`[GoogleDriveDisconnect] Revoke threw [userId=${user.id}]:`, err)
  }

  await deleteDriveConnectionByUserId(user.id)
  return NextResponse.json({ ok: true })
}
