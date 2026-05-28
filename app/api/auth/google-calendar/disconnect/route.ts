import { NextResponse } from 'next/server'
import { AuthError, requireAgencyUser } from '@/lib/requireUser'
import {
  deleteCalendarConnectionByUserId,
  getCalendarConnectionByUserId,
} from '@/db/googleCalendarConnections'
import { decryptSecret } from '@/lib/crypto/secrets'

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export async function POST() {
  let userId: number
  try {
    const user = await requireAgencyUser()
    userId = user.id
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.reason }, { status: 401 })
    }
    throw err
  }

  // Best-effort revoke at Google so the refresh token can no longer be used.
  // Local row deletion is what matters — we proceed regardless of outcome.
  const existing = await getCalendarConnectionByUserId(userId)
  if (existing) {
    try {
      const refresh = decryptSecret(existing.refresh_token)
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
    } catch (err) {
      console.warn(`[GoogleCalendarOAuth] disconnect revoke threw [userId=${userId}]:`, err)
    }
  }

  await deleteCalendarConnectionByUserId(userId)
  return NextResponse.json({ ok: true })
}
