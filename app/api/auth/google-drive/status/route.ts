import { NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getDriveConnectionByUserId } from '@/db/googleDriveConnections'

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ connected: false }, { status: 401 })

  const connection = await getDriveConnectionByUserId(user.id)
  if (!connection) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    email: connection.google_email,
  })
}
