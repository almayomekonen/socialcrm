import { NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { checkFacebookConnection } from '@/lib/facebook/health'

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()
  if (!connection) {
    return NextResponse.json({ connected: false })
  }

  const health = await checkFacebookConnection(connection.page_id, connection.page_access_token)

  // Last lead received via Facebook for this user
  let lastLeadAt: string | null = null
  try {
    const lastLead = await db('clients')
      .where({ handlerId: user.id })
      .whereRaw(`"leadSource" LIKE ?`, ['facebook:%'])
      .orderBy('createdAt', 'desc')
      .select('createdAt')
      .first()
    lastLeadAt = lastLead?.createdAt ?? null
  } catch {
    // Non-critical — don't block the response
  }

  return NextResponse.json({
    connected: true,
    tokenValid: health.tokenValid,
    permissionsOk: health.permissionsOk,
    subscribed: health.subscribed,
    lastLeadAt,
    needsReconnect: health.needsReconnect,
    errors: health.errors,
  })
}
