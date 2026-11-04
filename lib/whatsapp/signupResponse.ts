import { NextResponse } from 'next/server'
import type { SignupFinish, SignupOwner } from '@/lib/whatsapp/finishEmbeddedSignup'
import {
  SIGNUP_RESUME_COOKIE,
  sealSignupResume,
  signupResumeCookieOptions,
  type SignupResumeState,
} from '@/lib/whatsapp/signupResume'

/**
 * The response for a finished attempt, and the fate of the kept token: kept when
 * it can still finish the signup without Meta's flow, otherwise deleted.
 */
export function signupResponse(finish: SignupFinish, owner: SignupOwner, state: SignupResumeState): NextResponse {
  const kept = { ...state, ...finish.keep }
  const sealed = finish.retryable ? sealSignupResume(kept, owner) : null
  const res = NextResponse.json(sealed ? { ...finish.body, resumable: true } : finish.body, { status: finish.status })
  if (sealed) res.cookies.set(SIGNUP_RESUME_COOKIE, sealed, signupResumeCookieOptions(kept))
  else res.cookies.delete(SIGNUP_RESUME_COOKIE)
  return res
}
