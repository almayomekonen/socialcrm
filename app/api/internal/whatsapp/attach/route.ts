import { NextRequest, NextResponse } from 'next/server'
import { requireProductAccess, AuthError, ProductAccessError } from '@/lib/requireUser'
import {
  attachExistingWabaForUser,
  type AttachExistingWabaReason,
} from '@/lib/whatsapp/attachExistingWaba'

function statusFor(reason: AttachExistingWabaReason): number {
  if (reason === 'unauthorized') return 401
  if (
    reason === 'forbidden' ||
    reason === 'agency_not_allowed' ||
    reason === 'attach_disabled'
  ) {
    return 403
  }
  if (reason === 'phone_claimed' || reason === 'already_connected') return 409
  if (reason === 'db_error') return 500
  return 400
}

/**
 * INTERNAL TEST-ONLY attach. No UI. Body: { wabaId, phoneNumberId, accessToken }.
 * Never log the token. Session cookie supplies the ADMIN + agency 103.
 */
export async function POST(req: NextRequest) {
  let body: { wabaId?: unknown; phoneNumberId?: unknown; accessToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'missing_fields' }, { status: 400 })
  }

  let user: { id: number; agencyId: number; role: string }
  try {
    const session = await requireProductAccess()
    user = { id: session.id, agencyId: session.agencyId, role: String(session.role) }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
    }
    if (err instanceof ProductAccessError) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })
    }
    return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 })
  }

  const result = await attachExistingWabaForUser(user, {
    wabaId: typeof body.wabaId === 'string' ? body.wabaId : '',
    phoneNumberId: typeof body.phoneNumberId === 'string' ? body.phoneNumberId : '',
    accessToken: typeof body.accessToken === 'string' ? body.accessToken : '',
  })

  if (result.ok === false) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: statusFor(result.reason) })
  }
  return NextResponse.json({ ok: true })
}
