import { NextRequest, NextResponse } from 'next/server'
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
