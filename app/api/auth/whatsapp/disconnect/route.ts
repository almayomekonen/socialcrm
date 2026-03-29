import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'

export async function POST(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await db('whatsapp_connections').where({ user_id: user.id }).delete()

  return NextResponse.json({ ok: true })
}
