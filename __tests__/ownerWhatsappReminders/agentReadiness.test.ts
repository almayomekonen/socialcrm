import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { checkAgentPlatformReadiness, NOT_VERIFIABLE } from '@/lib/whatsapp/platform/agentReadiness'
import { GET } from '@/app/api/internal/owner-wa/readiness/route'

/**
 * The WhatsApp ASSISTANT's platform readiness: read-only (every request a GET,
 * none to /messages), nothing secret in the result, unknown or failed reads
 * reported as `unavailable` and never as a pass, and the reminder readiness
 * response unchanged when `scope=agent` is absent.
 */
const TOKEN = 'EAAG_agent_readiness_token_not_real_0123456789'
const APP = '962521689620138'
const WABA = '2000000000002'
const PHONE = '1000000000001'
const ENV = {
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PHONE,
  PLATFORM_WHATSAPP_WABA_ID: WABA,
  PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN,
  META_APP_ID: APP,
  META_APP_SECRET: 'app-secret-not-real',
  OWNER_WA_REMINDERS_AGENCY_IDS: '103',
  WA_ASSISTANT_AGENCY_IDS: '103',
  CRON_SECRET: 'cron-secret-not-real',
}

type Graph = {
  debug: unknown
  phone: Record<string, unknown>
  subs: { status: number; body: unknown }
  business: { status: number; body: unknown }
  review: { status: number; body: unknown }
}
const GOOD: Graph = {
  debug: {
    data: {
      is_valid: true,
      type: 'SYSTEM_USER',
      app_id: APP,
      expires_at: 0,
      scopes: [],
      granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: [WABA] }],
    },
  },
  phone: {
    status: 'CONNECTED',
    quality_rating: 'GREEN',
    whatsapp_business_manager_messaging_limit: 'TIER_1K',
    name_status: 'APPROVED',
    health_status: { can_send_message: 'AVAILABLE' },
  },
  subs: { status: 200, body: { data: [{ whatsapp_business_api_data: { id: APP, name: 'SocialCRM', link: 'x' } }] } },
  business: { status: 200, body: { business_verification_status: 'verified', id: WABA } },
  review: { status: 200, body: { account_review_status: 'APPROVED', id: WABA } },
}

function mockGraph(over: Partial<Graph> = {}) {
  const g = { ...GOOD, ...over }
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    if (u.includes('debug_token')) return json(g.debug)
    if (u.includes('/me?')) return json({ id: '1', name: 'x' })
    if (u.includes('message_templates')) return json({ data: [] })
    if (u.includes('subscribed_apps')) return json(g.subs.body, g.subs.status)
    if (u.includes('business_verification_status')) return json(g.business.body, g.business.status)
    if (u.includes('account_review_status')) return json(g.review.body, g.review.status)
    return json(g.phone)
  })
}
const check = async (name: string, over: Partial<Graph> = {}) => {
  mockGraph(over)
  const r = await checkAgentPlatformReadiness()
  return { r, c: r.checks.find((x) => x.name === name)! }
}

beforeEach(() => Object.assign(process.env, ENV))
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('agent platform readiness (read-only)', () => {
  it('a ready number: every blocking check ok; every request a GET, none sends', async () => {
    const spy = mockGraph()
    const r = await checkAgentPlatformReadiness()
    expect(r.checks.map((c) => [c.name, c.state])).toEqual([
      ['config', 'ok'],
      ['token', 'ok'],
      ['phone', 'ok'],
      ['webhook', 'ok'],
      ['displayName', 'ok'],
      ['quality', 'ok'],
      ['business', 'ok'],
      ['accountReview', 'ok'],
    ])
    expect(r.ready).toBe(true)
    expect(r.assistantAgencies).toBe(1)
    for (const [url, init] of spy.mock.calls) {
      expect((init as RequestInit).method).toBe('GET')
      expect(String(url)).not.toMatch(/\/messages(\?|$)/)
    }
  })

  it("the reminder template is not part of the assistant's readiness", async () => {
    mockGraph()
    expect((await checkAgentPlatformReadiness()).checks.map((c) => c.name)).not.toContain('template')
  })

  it('payment, billing, the two-step PIN and capacity are listed as NOT verifiable, never implied', async () => {
    mockGraph()
    expect((await checkAgentPlatformReadiness()).notVerifiable).toEqual([...NOT_VERIFIABLE])
  })

  it("this app not subscribed to the WABA's webhooks blocks", async () => {
    const { r, c } = await check('webhook', {
      subs: { status: 200, body: { data: [{ whatsapp_business_api_data: { id: '111' } }] } },
    })
    expect(c).toMatchObject({ state: 'failed', detail: { subscribed: false, subscribedAppCount: 1 } })
    expect(r.ready).toBe(false)
  })

  it('an unreadable subscription list is unavailable — and blocks, because it is not proven', async () => {
    const { r, c } = await check('webhook', { subs: { status: 403, body: { error: { code: 200, message: `bad ${TOKEN}` } } } })
    expect(c).toMatchObject({ state: 'unavailable', detail: { httpStatus: 403, code: 200 } })
    expect(r.ready).toBe(false)
  })

  it.each([['PENDING_REVIEW'], ['DECLINED'], ['NONE']])('display name %s blocks', async (status) => {
    const { r, c } = await check('displayName', { phone: { ...GOOD.phone, name_status: status } })
    expect(c.state).toBe('failed')
    expect(r.ready).toBe(false)
  })

  it('AVAILABLE_WITHOUT_REVIEW is an approved display name', async () => {
    expect((await check('displayName', { phone: { ...GOOD.phone, name_status: 'AVAILABLE_WITHOUT_REVIEW' } })).c.state).toBe('ok')
  })

  it('quality YELLOW is a reported warning, not a block; RED blocks', async () => {
    const yellow = await check('quality', { phone: { ...GOOD.phone, quality_rating: 'YELLOW' } })
    expect(yellow.c.state).toBe('warning')
    expect(yellow.r.ready).toBe(true)
    vi.restoreAllMocks()
    const red = await check('quality', { phone: { ...GOOD.phone, quality_rating: 'RED' } })
    expect(red.c.state).toBe('failed')
    expect(red.r.ready).toBe(false)
  })

  it('quality reports the tier and the reasons Meta gives for a LIMITED number', async () => {
    const { c } = await check('quality', {
      phone: {
        ...GOOD.phone,
        health_status: {
          can_send_message: 'LIMITED',
          entities: [
            { entity_type: 'WABA', can_send_message: 'LIMITED', errors: [{ error_code: 141006, error_description: 'x' }] },
          ],
        },
      },
    })
    expect(c.detail).toMatchObject({
      messagingLimitTier: 'TIER_1K',
      canSendMessage: 'LIMITED',
      entities: [{ entityType: 'WABA', canSendMessage: 'LIMITED', errors: [141006] }],
    })
  })

  it('business verification not "verified" is a warning, never silently ok', async () => {
    const { r, c } = await check('business', { business: { status: 200, body: { business_verification_status: 'pending' } } })
    expect(c).toMatchObject({ severity: 'warning', state: 'warning', detail: { business_verification_status: 'pending' } })
    expect(r.ready).toBe(true)
  })

  it.each([
    [
      'the field is not exposed by this Graph version (error #100)',
      { status: 400, body: { error: { code: 100, message: 'Tried accessing nonexisting field' } } },
    ],
    ['the field is missing from a 200', { status: 200, body: { id: WABA } }],
  ])('business verification unreadable — %s — is unavailable, not a pass', async (_l, business) => {
    expect((await check('business', { business })).c.state).toBe('unavailable')
  })

  it('account review: APPROVED ok, anything else a warning, unreadable unavailable', async () => {
    expect((await check('accountReview')).c.state).toBe('ok')
    vi.restoreAllMocks()
    expect((await check('accountReview', { review: { status: 200, body: { account_review_status: 'PENDING' } } })).c.state).toBe(
      'warning',
    )
    vi.restoreAllMocks()
    expect((await check('accountReview', { review: { status: 400, body: { error: { code: 100 } } } })).c.state).toBe(
      'unavailable',
    )
  })

  it('nothing in the result is a secret, even when Meta echoes the token in an error', async () => {
    mockGraph({
      subs: { status: 400, body: { error: { code: 190, message: `Invalid OAuth token ${TOKEN}` } } },
      business: { status: 400, body: { error: { code: 100, message: TOKEN } } },
    })
    const text = JSON.stringify(await checkAgentPlatformReadiness())
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('app-secret-not-real')
    expect(text).not.toContain(PHONE)
  })

  it('without the platform configuration nothing is fetched beyond the reminder check, and it is not ready', async () => {
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
    const spy = mockGraph()
    const r = await checkAgentPlatformReadiness()
    expect(r.ready).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the readiness route', () => {
  const req = (q = '', auth = `Bearer ${ENV.CRON_SECRET}`) =>
    new NextRequest(`https://x.test/api/internal/owner-wa/readiness${q}`, { headers: { authorization: auth } })

  it('without scope: the owner-reminder readiness, unchanged', async () => {
    mockGraph()
    const body = await (await GET(req())).json()
    expect(body.checks.map((c: { name: string }) => c.name)).toEqual(['config', 'token', 'phone', 'template'])
    expect(body).not.toHaveProperty('notVerifiable')
  })

  it('scope=agent: the assistant readiness', async () => {
    mockGraph()
    const body = await (await GET(req('?scope=agent'))).json()
    expect(body).toMatchObject({ ready: true, notVerifiable: [...NOT_VERIFIABLE] })
  })

  it('still CRON_SECRET only, in either scope', async () => {
    const spy = mockGraph()
    expect((await GET(req('?scope=agent', 'Bearer wrong'))).status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })
})
