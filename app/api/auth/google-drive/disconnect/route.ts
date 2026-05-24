import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { decryptSecret } from '@/lib/crypto/secrets'
import { deleteDriveConnectionByUserId, getDriveConnectionByUserId } from '@/db/googleDriveConnections'

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export async function POST(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
