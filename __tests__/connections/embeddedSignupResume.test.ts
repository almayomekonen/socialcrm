/**
 * After Meta's code becomes a token, no temporary failure may lose it, and the
 * guard against a false "connected" row still holds. Also: several accounts are
 * settled by Graph, and nothing secret reaches a log or an analytics event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => {
  const state = {
    existing: null as { agency_id: number; onboarding_type?: string | null; phone_number_id?: string } | null,
    saved: [] as Record<string, unknown>[],
    conditions: [] as unknown[][],
    saveFailures: 0,
    claimedByAnother: false,
    commitThenFail: false,
  }
  const qb: Record<string, unknown> = {}
  qb.where = () => qb
  qb.first = async () => state.existing
  let pending: Record<string, unknown> | null = null
  qb.insert = (row: Record<string, unknown>) => {
    pending = row
    return qb
  }
  qb.onConflict = () => qb
  qb.merge = () => {
    if (state.saveFailures > 0) {
      state.saveFailures -= 1
      if (state.commitThenFail) state.existing = { agency_id: 69, onboarding_type: 'coexistence', phone_number_id: 'P1' }
      throw new Error('db down')
    }
    return {
      where: (column: string, agencyId: number) => ({
        returning: async () => {
          state.conditions.push([column, agencyId])
          if (state.claimedByAnother) return []
          state.saved.push(pending!)
          return [{ id: 1 }]
        },
      }),
    }
  }
  return { state, db: Object.assign(() => qb, { raw: async () => ({}) }) }
})

vi.mock('@/config/db', () => ({ db: h.db }))
vi.mock('@/db/auth', () => ({ getUser: vi.fn() }))
vi.mock('@/lib/analytics/track', () => ({ track: vi.fn(), trackOncePerAgency: vi.fn(), trackFirstRealLeadOnce: vi.fn() }))
vi.mock('@/db/whatsapp', () => ({ deleteWhatsappConnectionsForAgency: vi.fn(async () => 1), getWhatsappConnectionAuditForAgency: vi.fn(async () => null) }))
vi.mock('@/lib/whatsapp/registration', () => ({ ensureMessagingReady: vi.fn(async () => ({ ready: true, status: 'CONNECTED' })) }))

import { POST } from '@/app/api/whatsapp/embedded-signup/route'
import { DELETE as DISCARD, POST as RESUME } from '@/app/api/whatsapp/embedded-signup/resume/route'
import { POST as DISCONNECT } from '@/app/api/auth/whatsapp/disconnect/route'
import { getUser } from '@/db/auth'
import { track } from '@/lib/analytics/track'
import { SIGNUP_RESUME_COOKIE, readSignupResume, sealSignupResume } from '@/lib/whatsapp/signupResume'
import { isSealedWhatsappAccessToken, resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

const OWNER = { agencyId: 69, userId: 298 }
const TOKEN = 'tok_SECRET_abc'
const CODE = 'code_SECRET_xyz'
const ATTEMPT = 'attempt-1234'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

const GRAPH_DOWN = { error: { message: 'Temporarily unavailable', code: 2, fbtrace_id: 'TraceAbc' } }

function mockGraph(opts: { subscribe?: Array<() => Response>; phones?: Record<string, unknown> } = {}) {
  const subscribe = [...(opts.subscribe ?? [])]
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('oauth/access_token')) return json(200, { access_token: TOKEN })
    if (u.includes('fields=is_on_biz_app,platform_type')) return json(200, { is_on_biz_app: false })
    if (u.includes('/phone_numbers')) {
      const id = u.match(/\/([^/]+)\/phone_numbers/)![1]
      const rows = opts.phones?.[id]
      if (rows === 'down') return json(500, GRAPH_DOWN)
      return json(200, { data: rows ?? [] })
    }
    if (u.includes('subscribed_apps')) {
      const next = subscribe.shift()
      return next ? next() : json(200, { success: true })
    }
    return json(200, {})
  }) as unknown as typeof fetch
}

const subscribeCalls = () => vi.mocked(global.fetch).mock.calls.filter(([u]) => String(u).includes('subscribed_apps'))

function signup(body: Record<string, unknown>) {
  return POST(new NextRequest('https://getsocialcrm.com/api/whatsapp/embedded-signup', { method: 'POST', body: JSON.stringify({ code: CODE, attemptId: ATTEMPT, ...body }) }))
}

function resume(cookie?: string) {
  const req = new NextRequest('https://getsocialcrm.com/api/whatsapp/embedded-signup/resume', { method: 'POST' })
  if (cookie) req.cookies.set(SIGNUP_RESUME_COOKIE, cookie)
  return RESUME(req)
}

const failureProps = () => vi.mocked(track).mock.calls.map(([a]) => a as { event: string; props: Record<string, unknown> }).filter((a) => a.event === 'whatsapp_connect_failed').map((a) => a.props)

let logged: unknown[][]
beforeEach(() => {
  h.state.existing = null
  h.state.saved = []
  h.state.saveFailures = 0
  h.state.claimedByAnother = false
  h.state.commitThenFail = false
  h.state.conditions = []
  logged = []
  vi.mocked(track).mockClear()
  vi.mocked(getUser).mockResolvedValue({ id: OWNER.userId, agencyId: OWNER.agencyId, role: 'ADMIN', email: 'x@example.com' } as never)
  vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args))
  vi.spyOn(console, 'warn').mockImplementation((...args) => void logged.push(args))
})
afterEach(() => vi.restoreAllMocks())

describe('a temporary failure after Meta finished', () => {
  it('a subscribe 5xx is retried and the signup completes', async () => {
    mockGraph({ subscribe: [() => json(500, GRAPH_DOWN)] })
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(200)
    expect(subscribeCalls()).toHaveLength(2)
    expect(h.state.saved).toHaveLength(1)
  })

  it('a subscribe that keeps failing: no row, Meta’s trace id recorded, and the token kept sealed', async () => {
    mockGraph({ subscribe: [() => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN)] })
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(502)
    expect(await r.json()).toMatchObject({ error: 'subscribe_incomplete', resumable: true })
    expect(subscribeCalls()).toHaveLength(3)
    expect(h.state.saved).toHaveLength(0)
    expect(failureProps()[0]).toMatchObject({ reason: 'SUBSCRIBED_APPS_FAILED', stage: 'subscribe', metaStatus: 500, metaCode: 2, metaTraceId: 'TraceAbc', attemptId: ATTEMPT })

    const cookie = r.cookies.get(SIGNUP_RESUME_COOKIE)!
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.value).not.toContain(TOKEN)
    expect(readSignupResume(cookie.value, OWNER)).toMatchObject({ accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', attemptId: ATTEMPT })
  })

  it('a rate limit sent as HTTP 400 is not retried now, but the token is kept', async () => {
    mockGraph({ subscribe: [() => json(400, { error: { message: 'Too many calls', code: 80008 } })] })
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(await r.json()).toMatchObject({ resumable: true })
    expect(subscribeCalls()).toHaveLength(1)
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeTruthy()
  })

  it('every Graph call after the token has a time limit', async () => {
    mockGraph({ phones: { W1: [{ id: 'P1' }] } })
    await signup({ wabaId: 'W1' })
    const graphCalls = vi.mocked(global.fetch).mock.calls.filter(([u]) => /phone_numbers|subscribed_apps|is_on_biz_app|oauth/.test(String(u)))
    expect(graphCalls.length).toBeGreaterThanOrEqual(4)
    for (const [, init] of graphCalls) expect((init as RequestInit)?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a subscribe 4xx is final: not retried, not kept, and the failure says why', async () => {
    mockGraph({ subscribe: [() => json(400, { error: { message: 'Object does not exist', code: 100 } })] })
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(502)
    expect(await r.json()).not.toHaveProperty('resumable')
    expect(subscribeCalls()).toHaveLength(1)
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
    expect(failureProps()[0]).toMatchObject({ metaCode: 100 })
    expect(failureProps()[0]).not.toHaveProperty('permanent')
  })

  it('a save that fails twice is kept; resume finishes it without Meta and deletes the cookie', async () => {
    mockGraph()
    h.state.saveFailures = 2
    const failed = await signup({ wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'coexistence' })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'DB error', resumable: true })
    expect(h.state.saved).toHaveLength(0)

    const callsBefore = vi.mocked(global.fetch).mock.calls.length
    const resumed = await resume(failed.cookies.get(SIGNUP_RESUME_COOKIE)!.value)
    expect(resumed.status).toBe(200)
    expect(await resumed.json()).toMatchObject({ ok: true })
    // Sealed at rest: never the plaintext, and it opens back to the token Meta issued.
    const stored = String((h.state.saved[0] as { access_token: string }).access_token)
    expect(stored).not.toContain(TOKEN)
    expect(isSealedWhatsappAccessToken(stored)).toBe(true)
    expect(resolveWhatsappAccessToken(stored)).toBe(TOKEN)
    expect(h.state.saved[0]).toMatchObject({ waba_id: 'W1', phone_number_id: 'P1', agency_id: OWNER.agencyId, user_id: OWNER.userId, onboarding_type: 'coexistence' })
    expect(resumed.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
    // The code was never used again.
    expect(vi.mocked(global.fetch).mock.calls.slice(callsBefore).some(([u]) => String(u).includes('oauth/access_token'))).toBe(false)
  })

  it('a save that fails once is retried in the same request', async () => {
    mockGraph()
    h.state.saveFailures = 1
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(200)
    expect(h.state.saved).toHaveLength(1)
  })

  it('a resume that fails again stays resumable', async () => {
    mockGraph({ subscribe: [() => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN)] })
    const sealed = sealSignupResume({ accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', browserOnboardingType: 'cloud_api' }, OWNER)!
    const r = await resume(sealed)
    expect(await r.json()).toMatchObject({ resumable: true })
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeTruthy()
  })
})

describe('the kept token', () => {
  it.each([
    ['no cookie', undefined],
    ['a tampered cookie', 'wsr1.not-a-real-envelope'],
  ])('%s: refused, and the customer goes back through Meta', async (_label, cookie) => {
    mockGraph()
    const r = await resume(cookie)
    expect(r.status).toBe(410)
    expect(await r.json()).toMatchObject({ error: 'not_completed' })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(h.state.saved).toHaveLength(0)
  })

  it('another agency’s or user’s cookie is refused', async () => {
    mockGraph()
    const state = { accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', browserOnboardingType: 'cloud_api' as const }
    for (const owner of [{ agencyId: 70, userId: OWNER.userId }, { agencyId: OWNER.agencyId, userId: 1 }]) {
      const r = await resume(sealSignupResume(state, owner)!)
      expect(r.status).toBe(410)
    }
    expect(h.state.saved).toHaveLength(0)
  })

  it('the agency has since connected a different number: forgotten, nothing subscribed or saved', async () => {
    mockGraph()
    h.state.existing = { agency_id: OWNER.agencyId, phone_number_id: 'P-OTHER' }
    const sealed = sealSignupResume({ accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', browserOnboardingType: 'cloud_api' }, OWNER)!
    const r = await resume(sealed)
    expect(r.status).toBe(410)
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(h.state.saved).toHaveLength(0)
  })

  it('the same number is already connected: it still finishes', async () => {
    mockGraph()
    h.state.existing = { agency_id: OWNER.agencyId, phone_number_id: 'P1' }
    const sealed = sealSignupResume({ accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', browserOnboardingType: 'cloud_api' }, OWNER)!
    expect((await resume(sealed)).status).toBe(200)
    expect(h.state.saved).toHaveLength(1)
  })

  it('the cookie: httpOnly, lax, path /, secure in production, and the token is in no response', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      mockGraph({ subscribe: [() => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN)] })
      const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
      const header = r.headers.get('set-cookie')!
      expect(header).toMatch(/HttpOnly/i)
      expect(header).toMatch(/Secure/i)
      expect(header).toMatch(/SameSite=lax/i)
      expect(header).toMatch(/Path=\//i)
      expect(header).toMatch(/Max-Age=86400/i)
      expect(header).not.toContain(TOKEN)
      expect(await r.text()).not.toContain(TOKEN)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('deleting it clears the same path, so the browser really drops it', async () => {
    mockGraph()
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.headers.get('set-cookie')).toMatch(new RegExp(`${SIGNUP_RESUME_COOKIE}=;.*Path=/;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)`, 'i'))
  })

  it('a failed resume does not extend its life', async () => {
    mockGraph({ subscribe: [() => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN)] })
    const expiresAt = Date.now() + 3_600_000
    const sealed = sealSignupResume({ accessToken: TOKEN, wabaId: 'W1', phoneNumberId: 'P1', browserOnboardingType: 'cloud_api', expiresAt }, OWNER)!
    const r = await resume(sealed)
    const cookie = r.cookies.get(SIGNUP_RESUME_COOKIE)!
    expect(readSignupResume(cookie.value, OWNER)?.expiresAt).toBe(expiresAt)
    expect(cookie.maxAge).toBeLessThanOrEqual(3600)
  })

  it('disconnecting deletes it', async () => {
    const r = await DISCONNECT(new NextRequest('https://getsocialcrm.com/api/auth/whatsapp/disconnect', { method: 'POST' }))
    expect(r.status).toBe(200)
    const set = r.cookies.get(SIGNUP_RESUME_COOKIE)
    expect(set).toBeDefined()
    expect(set?.value).toBeFalsy()
  })

  it('DELETE forgets it', async () => {
    const r = await DISCARD()
    expect(r.status).toBe(200)
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
  })

  it('expires', () => {
    const state = { accessToken: TOKEN, browserOnboardingType: 'cloud_api' as const }
    const sealed = sealSignupResume(state, OWNER, 1000)!
    expect(readSignupResume(sealed, OWNER, 2000)).not.toBeNull()
    expect(readSignupResume(sealed, OWNER, 1000 + 25 * 3600 * 1000)).toBeNull()
  })

  it('a number held by another agency is final: the token is not kept', async () => {
    mockGraph()
    h.state.existing = { agency_id: 999 }
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(409)
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
    expect(h.state.saved).toHaveLength(0)
  })
})

describe('the save', () => {
  it('only updates this agency’s own row', async () => {
    mockGraph()
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(h.state.conditions).toEqual([['whatsapp_connections.agency_id', OWNER.agencyId]])
  })

  it('another agency saved the number after the check: refused, not moved, not kept', async () => {
    mockGraph()
    h.state.claimedByAnother = true
    const r = await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ reason: 'RESOURCE_CLAIMED' })
    expect(r.cookies.get(SIGNUP_RESUME_COOKIE)?.value).toBeFalsy()
    expect(failureProps()[0]).toMatchObject({ reason: 'RESOURCE_CLAIMED', stage: 'ownership' })
  })

  it('a save that committed but reported failure still gets its one-time sync on resume', async () => {
    mockGraph()
    vi.mocked(global.fetch).mockClear()
    h.state.saveFailures = 2
    h.state.commitThenFail = true
    const failed = await signup({ wabaId: 'W1', phoneNumberId: 'P1', onboardingType: 'coexistence' })
    const cookie = failed.cookies.get(SIGNUP_RESUME_COOKIE)!.value
    expect(readSignupResume(cookie, OWNER)?.syncPending).toBe(true)
    await resume(cookie)
    expect(vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes('/smb_app_data'))).toBe(true)
  })

  it('a real reconnect of a Coexistence number does not repeat the sync', async () => {
    mockGraph()
    h.state.existing = { agency_id: OWNER.agencyId, onboarding_type: 'coexistence' }
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes('/smb_app_data'))).toBe(false)
  })
})

describe('several accounts', () => {
  it('Graph picks the account that holds the number Meta named', async () => {
    mockGraph({ phones: { W1: [{ id: 'P9' }], W2: [{ id: 'P1' }] } })
    const r = await signup({ wabaCandidates: ['W1', 'W2'], phoneNumberId: 'P1' })
    expect(r.status).toBe(200)
    expect(h.state.saved[0]).toMatchObject({ waba_id: 'W2', phone_number_id: 'P1' })
    expect(String(subscribeCalls()[0][0])).toContain('/W2/subscribed_apps')
  })

  it('no number named: the only account with one identifiable number', async () => {
    mockGraph({ phones: { W1: [], W2: [{ id: 'P7' }] } })
    const r = await signup({ wabaCandidates: ['W1', 'W2'] })
    expect(r.status).toBe(200)
    expect(h.state.saved[0]).toMatchObject({ waba_id: 'W2', phone_number_id: 'P7' })
  })

  it.each([
    ['the number is in both accounts', { W1: [{ id: 'P1' }], W2: [{ id: 'P1' }] }, 'P1'],
    ['the number is in neither', { W1: [{ id: 'P8' }], W2: [{ id: 'P9' }] }, 'P1'],
    ['two accounts each have one number', { W1: [{ id: 'P8' }], W2: [{ id: 'P9' }] }, undefined],
  ])('%s: refused, nothing subscribed or saved', async (_label, phones, phoneNumberId) => {
    mockGraph({ phones })
    const r = await signup({ wabaCandidates: ['W1', 'W2'], phoneNumberId })
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ reason: 'WABA_NOT_FOUND' })
    expect(subscribeCalls()).toHaveLength(0)
    expect(h.state.saved).toHaveLength(0)
    expect(failureProps()[0]).toMatchObject({ stage: 'discover', resolution: 'ambiguous', accountCount: 2 })
  })

  it('a failed lookup is temporary and kept, even if another account matched', async () => {
    mockGraph({ phones: { W1: 'down', W2: [{ id: 'P1' }] } })
    const r = await signup({ wabaCandidates: ['W1', 'W2'], phoneNumberId: 'P1' })
    expect(await r.json()).toMatchObject({ reason: 'PHONE_NOT_FOUND', resumable: true })
    expect(h.state.saved).toHaveLength(0)
  })

  it('ignores malformed candidates', async () => {
    mockGraph()
    const r = await signup({ wabaCandidates: ['../evil', 7, ''] })
    expect(await r.json()).toMatchObject({ reason: 'WABA_NOT_FOUND' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('FINISH_ONLY_WABA on the server', () => {
  it('a number on the account: connected', async () => {
    mockGraph({ phones: { W1: [{ id: 'P3' }] } })
    const r = await signup({ wabaId: 'W1' })
    expect(r.status).toBe(200)
    expect(h.state.saved[0]).toMatchObject({ waba_id: 'W1', phone_number_id: 'P3' })
  })

  it('no number yet: a clear failure, no row, nothing subscribed', async () => {
    mockGraph({ phones: { W1: [] } })
    const r = await signup({ wabaId: 'W1' })
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ error: 'no_phones', reason: 'PHONE_NOT_FOUND' })
    expect(await failureProps()[0]).toMatchObject({ resolution: 'none_found' })
    expect(subscribeCalls()).toHaveLength(0)
    expect(h.state.saved).toHaveLength(0)
  })
})

describe('nothing secret leaves the route', () => {
  it('no token, code or app secret in any event or log, on any failure path', async () => {
    process.env.META_APP_SECRET = 'appsecret_SECRET'
    mockGraph({ subscribe: [() => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN), () => json(500, GRAPH_DOWN)] })
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    global.fetch = vi.fn(async () => {
      throw new TypeError(`fetch failed for https://graph.facebook.com/oauth/access_token?client_secret=appsecret_SECRET&code=${CODE}`)
    }) as unknown as typeof fetch
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(failureProps().at(-1)).toMatchObject({ reason: 'TOKEN_EXCHANGE_FAILED', networkError: 'TypeError' })
    const everything = JSON.stringify([vi.mocked(track).mock.calls, logged.map((args) => args.map(String))])
    expect(everything).not.toContain('SECRET')
  })

  it('Meta’s text is stored without anything resembling a credential', async () => {
    mockGraph({ subscribe: [() => json(400, { error: { message: 'Bad token EAAGm0PX4ZCpsBAOabcdefghijklmnopqrstuvwxyz0123', code: 190 } })] })
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(failureProps()[0].metaErrorMessage).toBe('Bad token [redacted]')
  })

  it('Meta’s text is stored without phone numbers or emails', async () => {
    mockGraph({ subscribe: [() => json(400, { error: { message: 'Number +972 50 123 4567 of a@b.co is invalid', code: 100 } })] })
    await signup({ wabaId: 'W1', phoneNumberId: 'P1' })
    expect(failureProps()[0].metaErrorMessage).toBe('Number [number] of [email] is invalid')
  })
})
