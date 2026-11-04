import { NextRequest, NextResponse } from 'next/server'
import { requireAgencyAdmin, statusFor } from '@/lib/api/routeAuth'
import { track } from '@/lib/analytics/track'
import { WA_REASON, WA_REASON_NOTICE_CODE, type WaReason } from '@/lib/connections/reasons'
import { CONNECT_ATTEMPT_ID } from '@/lib/connections/lateCancelDetail'
import { COEXISTENCE_GRAPH_VERSION, type OnboardingType } from '@/lib/whatsapp/coexistence'
import { finishEmbeddedSignup, type SignupOwner } from '@/lib/whatsapp/finishEmbeddedSignup'
import { errorName, GRAPH_CALL_TIMEOUT_MS, graphFailureDetail } from '@/lib/whatsapp/signupSteps'
import { signupResponse } from '@/lib/whatsapp/signupResponse'
import type { SignupResumeState } from '@/lib/whatsapp/signupResume'

// OAuth exchange: this flow's supported version, not the expired app-wide v19.0.
const GRAPH = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_ACCOUNT_CANDIDATES = 20
const EXCHANGE_RETRY_DELAY_MS = 500

type SignupBody = {
  code?: string
  wabaId?: string
  wabaCandidates?: unknown
  phoneNumberId?: string
  onboardingType?: OnboardingType
  attemptId?: unknown
}

function accountCandidates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const valid = raw.filter((id): id is string => typeof id === 'string' && ACCOUNT_ID.test(id))
  return [...new Set(valid)].slice(0, MAX_ACCOUNT_CANDIDATES)
}

/** One retry, and only for a network failure or a 5xx: Meta's code works once, so a 4xx is final. */
async function exchangeCode(code: string): Promise<{ accessToken: string } | { detail: Record<string, string | number | boolean> }> {
  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!
  let detail: Record<string, string | number | boolean> = {}
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, EXCHANGE_RETRY_DELAY_MS))
    try {
      const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`, { signal: AbortSignal.timeout(GRAPH_CALL_TIMEOUT_MS) })
      if (res.ok) {
        const data = await res.json()
        return data.access_token ? { accessToken: data.access_token } : { detail: {} }
      }
      detail = await graphFailureDetail(res)
      console.error('[WA EmbeddedSignup] token exchange failed:', detail)
      if (res.status < 500) return { detail }
    } catch (e) {
      // The name only: this URL carries the app secret and the code.
      detail = { networkError: errorName(e) }
      console.error('[WA EmbeddedSignup] token exchange threw:', detail)
    }
  }
  return { detail }
}

export async function POST(req: NextRequest) {
  // The Embedded Signup path is the sibling of /api/auth/whatsapp/connect and
  // writes the same `whatsapp_connections` row, so it carries the same admin
  // boundary. Guarding only the other endpoint would have left this one open.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: statusFor(auth.reason) })
  }
  const user = auth.user
  const agencyId = user.agencyId
  const owner: SignupOwner = { agencyId, userId: user.id }

  let body: SignupBody
  try {
    body = await req.json()
  } catch {
    track({ agencyId, userId: user.id, event: 'whatsapp_connect_failed', props: { reason: 'INVALID_BODY', stage: 'request' } })
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const attemptId = typeof body.attemptId === 'string' && CONNECT_ATTEMPT_ID.test(body.attemptId) ? body.attemptId : undefined
  const withAttempt = <T extends object>(props: T) => (attemptId ? { ...props, attemptId } : props)

  /** A failure before any token exists: nothing can be kept. */
  const fail = (reason: WaReason, stage: string, detail: Record<string, string | number | boolean> = {}) => {
    track({ agencyId, userId: user.id, event: 'whatsapp_connect_failed', props: withAttempt({ reason, stage, ...detail }) })
    return NextResponse.json({ ok: false, error: WA_REASON_NOTICE_CODE[reason], reason }, { status: 400 })
  }

  const { code, wabaId } = body
  const wabaCandidates = accountCandidates(body.wabaCandidates)

  if (!code) {
    track({ agencyId, userId: user.id, event: 'whatsapp_connect_failed', props: withAttempt({ reason: 'MISSING_CODE', stage: 'request' }) })
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  // An account is required to subscribe the app for inbound messages. Without it
  // the connection could never receive leads, so we refuse to persist one.
  if (!wabaId && !wabaCandidates.length) return fail(WA_REASON.WABA_NOT_FOUND, 'discover')

  // Exchange the OAuth code for an access token.
  const exchanged = await exchangeCode(code)
  if (!('accessToken' in exchanged)) return fail(WA_REASON.TOKEN_EXCHANGE_FAILED, 'token', exchanged.detail)

  const state: SignupResumeState = {
    accessToken: exchanged.accessToken,
    wabaId,
    wabaCandidates: wabaId ? undefined : wabaCandidates,
    phoneNumberId: body.phoneNumberId,
    browserOnboardingType: body.onboardingType === 'coexistence' ? 'coexistence' : 'cloud_api',
    attemptId,
  }
  return signupResponse(await finishEmbeddedSignup(owner, state), owner, state)
}
