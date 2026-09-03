import { NextResponse } from 'next/server'
import { requireActiveAgencyUser, statusFor } from '@/lib/api/routeAuth'
import { getDriveConnectionByUserId } from '@/db/googleDriveConnections'

export async function GET() {
  // Reads the caller's own connection only. Self scope preserved; the change is
  // that a suspended account no longer reads it.
  const auth = await requireActiveAgencyUser()
  if (!auth.ok) {
    return NextResponse.json({ connected: false }, { status: statusFor(auth.reason) })
  }
  const user = auth.user

  const connection = await getDriveConnectionByUserId(user.id)
  if (!connection) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    email: connection.google_email,
  })
}
