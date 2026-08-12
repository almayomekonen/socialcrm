import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { deletePushSubscription } from '@/db/notifications/subscriptions'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import { z } from 'zod'

/**
 * POST /api/notifications/push/unsubscribe — P3.1. Spec §15.3, §20.5.
 *
 * Session-scoped delete. An endpoint belonging to another user deletes zero
 * rows and returns removed:0 — never an oracle that confirms ownership.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const

const BodySchema = z.object({
  endpoint: z
    .string()
    .min(1)
    .max(2048)
    .refine((v) => /^https:\/\//i.test(v), { message: 'endpoint-must-be-https' }),
})

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user?.agencyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return NextResponse.json({ error: 'product-access-required' }, { status: 403, headers: NO_STORE })
  }
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) {
    return NextResponse.json({ error: 'notifications-disabled' }, { status: 404, headers: NO_STORE })
  }

  const raw = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid-endpoint' }, { status: 400, headers: NO_STORE })
  }

  const removed = await deletePushSubscription({
    agencyId: user.agencyId,
    userId: user.id,
    endpoint: parsed.data.endpoint,
  })

  return NextResponse.json({ ok: true, removed }, { headers: NO_STORE })
}
