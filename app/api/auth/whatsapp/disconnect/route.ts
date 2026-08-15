import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { deleteWhatsappConnectionsForAgency } from '@/db/whatsapp'

export async function POST(_req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteWhatsappConnectionsForAgency(user.agencyId)

  return NextResponse.json({ ok: true })
}
