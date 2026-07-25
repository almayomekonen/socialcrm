import { NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { listTemplates } from '@/db/whatsappTemplates'
import { getAgencyProductAccess } from '@/lib/access/productAccess'

/**
 * The client poll target — the agency's ready-made messages, read from the LOCAL
 * database only (never Graph). Sprint 4: the adaptive poll hits this while a row
 * is pending to observe the webhook/cron's DB writes converge.
 */
export async function GET() {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403 })
  }

  const templates = await listTemplates(user.agencyId)
  return NextResponse.json({ templates })
}
