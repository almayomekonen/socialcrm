import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
import { finishEmbeddedSignup } from '@/lib/whatsapp/finishEmbeddedSignup'
import { signupResponse } from '@/lib/whatsapp/signupResponse'
import { readSignupResume, SIGNUP_RESUME_COOKIE } from '@/lib/whatsapp/signupResume'

/**
 * Finishes a signup whose Meta part is already done, from the sealed cookie the
 * main route left when its own next step failed. The browser sends nothing: the
 * token, account and number all come from the cookie, which is bound to this user
 * and agency. Same admin boundary as the main route.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const owner = { agencyId: auth.user.agencyId, userId: auth.user.id }

  const state = readSignupResume(req.cookies.get(SIGNUP_RESUME_COOKIE)?.value, owner)
  if (!state) {
    // Nothing usable. The customer goes back through Meta's flow.
    const res = NextResponse.json({ ok: false, error: 'not_completed' }, { status: 410 })
    res.cookies.delete(SIGNUP_RESUME_COOKIE)
    return res
  }

  // A kept signup is only for what it was kept for. If this agency has since
  // connected a different number (another tab or browser), finishing it would add
  // a second connection nobody chose just now. Forget it.
  let live: { phone_number_id: string } | undefined
  try {
    live = await db('whatsapp_connections').where({ agency_id: owner.agencyId }).first('phone_number_id')
  } catch {
    return NextResponse.json({ ok: false, error: 'network', resumable: true }, { status: 503 })
  }
  if (live && live.phone_number_id !== state.phoneNumberId) {
    const res = NextResponse.json({ ok: false, error: 'not_completed' }, { status: 410 })
    res.cookies.delete(SIGNUP_RESUME_COOKIE)
    return res
  }

  return signupResponse(await finishEmbeddedSignup(owner, state), owner, state)
}

/**
 * Forgets a kept signup. Called when the customer starts Meta's flow instead: what
 * they choose there replaces it, even if they then cancel.
 */
export async function DELETE() {
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SIGNUP_RESUME_COOKIE)
  return res
}
