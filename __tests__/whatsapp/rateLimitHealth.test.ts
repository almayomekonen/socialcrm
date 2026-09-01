/**
 * Meta rate limiting (#80008) must not be reported as a broken connection.
 *
 * Production 2026-09-01: the connection was healthy — System User token valid,
 * scopes correct, inbound flowing, DB health_status 'operational' — but Meta
 * began answering the status probe with
 *
 *   HTTP 400  (#80008) "There have been too many calls to this WhatsApp
 *   Business account. Wait a bit and try again."
 *
 * `classifyGraphFailure` had two buckets, so that landed in 'error'; the health
 * resolver turned it into `unknown`; the composer blocked BOTH free text and
 * templates and told the customer "צריך לאמת את חיבור ה-WhatsApp — כדאי לחבר
 * מחדש". Every claim there was false, and the suggested cure spends more calls
 * against an account already over its limit.
 *
 * NO WhatsApp message is sent by any test here: every Graph interaction is a
 * stubbed probe, and the send path is never invoked.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config/db', () => {
  const chain: Record<string, unknown> = {}
  chain.join = () => chain
  chain.where = () => chain
  chain.whereNotExists = () => chain
  chain.orderBy = () => chain
  chain.first = async () => null
  const db = Object.assign(() => chain, { raw: (sql: string) => sql })
  return { db }
})

import { resolveWhatsappHealth, type WhatsappHealthDeps } from '@/lib/whatsapp/operationalStatus'
import { probePhoneStatus, probeAppSubscribed } from '@/lib/whatsapp/registration'
import {
  resolveWhatsappComposerDecision,
  noticeForComposerHealth,
} from '@/lib/inbox/whatsappComposerDecision'
import { WHATSAPP_NOTICES } from '@/lib/connections/messages'

const conn = { phone_number_id: 'P1', access_token: 't', waba_id: 'W1' }

function deps(partial: Partial<WhatsappHealthDeps> = {}): WhatsappHealthDeps {
  return {
    hasInboundForPhone: async () => false,
    hasAccountFailure: async () => false,
    probePhone: async () => ({ ok: true, status: 'CONNECTED' }),
    probeSubscribed: async () => ({ ok: true, subscribed: true }),
    ...partial,
  }
}

/** Meta's real #80008 body: HTTP 400, type OAuthException — both misleading. */
const RATE_LIMITED = {
  ok: false,
  status: 400,
  json: async () => ({
    error: {
      message: 'There have been too many calls to this WhatsApp Business account.',
      type: 'OAuthException',
      code: 80008,
    },
  }),
} as Response

const stubFetch = (res: Response) => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url))
    return res
  })
  return calls
}

describe('A · #80008 is classified as throttled, not a generic error', () => {
  it('probePhoneStatus reports kind: throttled', async () => {
    stubFetch(RATE_LIMITED)
    expect(await probePhoneStatus('P1', 't')).toEqual({ ok: false, kind: 'throttled', httpStatus: 400 })
    vi.unstubAllGlobals()
  })

  it('probeAppSubscribed reports kind: throttled', async () => {
    stubFetch(RATE_LIMITED)
    expect(await probeAppSubscribed('W1', 't')).toEqual({ ok: false, kind: 'throttled', httpStatus: 400 })
    vi.unstubAllGlobals()
  })

  it('a real 190 is still token, and a plain 500 is still error', async () => {
    stubFetch({ ok: false, status: 200, json: async () => ({ error: { code: 190 } }) } as Response)
    expect(await probePhoneStatus('P1', 't')).toMatchObject({ ok: false, kind: 'token' })
    vi.unstubAllGlobals()

    stubFetch({ ok: false, status: 401, json: async () => ({}) } as Response)
    expect(await probePhoneStatus('P1', 't')).toMatchObject({ ok: false, kind: 'token' })
    vi.unstubAllGlobals()

    stubFetch({ ok: false, status: 500, json: async () => ({ error: { code: 1 } }) } as Response)
    expect(await probePhoneStatus('P1', 't')).toMatchObject({ ok: false, kind: 'error' })
    vi.unstubAllGlobals()
  })
})

describe('B · a throttled probe never yields the reconnect notice', () => {
  it('health is throttled, not unknown', async () => {
    const health = await resolveWhatsappHealth(
      conn,
      1,
      deps({ probePhone: async () => ({ ok: false, kind: 'throttled', httpStatus: 400 }) }),
    )
    expect(health.primary).toBe('throttled')
  })

  it('a throttled subscription probe also yields throttled', async () => {
    const health = await resolveWhatsappHealth(
      conn,
      1,
      deps({ probeSubscribed: async () => ({ ok: false, kind: 'throttled', httpStatus: 400 }) }),
    )
    expect(health.primary).toBe('throttled')
  })

  it('its copy reassures and offers NO action to click', () => {
    const notice = noticeForComposerHealth('throttled')
    expect(notice).toBe(WHATSAPP_NOTICES.throttled)
    expect(notice).not.toBe(WHATSAPP_NOTICES.needs_verification)
    expect(notice?.title).not.toMatch(/צריך לאמת/)
    // No action field: no surface can render a reconnect CTA from this notice.
    expect(notice?.action).toBeUndefined()
  })
})

describe('C · a throttled probe does NOT block the composer', () => {
  it('free text stays available inside an open service window', () => {
    const d = resolveWhatsappComposerDecision({
      leadId: 1,
      health: 'throttled',
      window: 'OPEN',
      templatesEnabled: true,
      hasApprovedTemplates: true,
    })
    expect(d.kind).not.toBe('health_blocked')
    expect(d.canSendFreeText).toBe(true)
  })

  it('templates stay available when the window is closed', () => {
    const d = resolveWhatsappComposerDecision({
      leadId: 1,
      health: 'throttled',
      window: 'CLOSED',
      templatesEnabled: true,
      hasApprovedTemplates: true,
    })
    expect(d.kind).not.toBe('health_blocked')
    expect(d.canSendTemplate).toBe(true)
  })
})

describe('D · genuine auth failures still block', () => {
  it('a token failure is still token, never throttled', async () => {
    const health = await resolveWhatsappHealth(
      conn,
      1,
      deps({ probePhone: async () => ({ ok: false, kind: 'token', httpStatus: 401 }) }),
    )
    expect(health.primary).toBe('token')
  })

  it('token blocks the composer and keeps its own copy', () => {
    const d = resolveWhatsappComposerDecision({
      leadId: 1,
      health: 'token',
      window: 'OPEN',
      templatesEnabled: true,
      hasApprovedTemplates: true,
    })
    expect(d.kind).toBe('health_blocked')
    expect(d.canSendFreeText).toBe(false)
    expect(d.canSendTemplate).toBe(false)
    expect(noticeForComposerHealth('token')).toBe(WHATSAPP_NOTICES.expired)
  })

  it('a token failure alongside a throttled subscription probe still reports token', async () => {
    // Priority matters: a rate limit must never mask a dead credential.
    const health = await resolveWhatsappHealth(
      conn,
      1,
      deps({
        probePhone: async () => ({ ok: false, kind: 'token', httpStatus: 401 }),
        probeSubscribed: async () => ({ ok: false, kind: 'throttled', httpStatus: 400 }),
      }),
    )
    expect(health.primary).toBe('token')
  })
})

describe('E · non-throttle failures are unchanged', () => {
  it('a generic error probe still yields unknown and still blocks', async () => {
    const health = await resolveWhatsappHealth(
      conn,
      1,
      deps({ probePhone: async () => ({ ok: false, kind: 'error', httpStatus: 500 }) }),
    )
    expect(health.primary).toBe('unknown')

    const d = resolveWhatsappComposerDecision({
      leadId: 1,
      health: health.primary,
      window: 'OPEN',
      templatesEnabled: true,
      hasApprovedTemplates: true,
    })
    expect(d.kind).toBe('health_blocked')
    expect(noticeForComposerHealth('unknown')).toBe(WHATSAPP_NOTICES.needs_verification)
  })

  it('a healthy probe is still operational and still sends', async () => {
    const health = await resolveWhatsappHealth(conn, 1, deps())
    expect(health.primary).toBe('operational')
  })
})

describe('F · no WhatsApp message is sent by these tests', () => {
  it('no probe ever touches the /messages endpoint', async () => {
    const calls = stubFetch(RATE_LIMITED)
    await probePhoneStatus('P1', 't')
    await probeAppSubscribed('W1', 't')
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((u) => u.includes('/messages'))).toBe(false)
    vi.unstubAllGlobals()
  })
})
