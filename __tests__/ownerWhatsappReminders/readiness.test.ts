import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOwnerReminderReadiness, healthLimitations } from '@/lib/whatsapp/platform/readiness'

/**
 * The readiness check reads Meta and never sends: every request is a GET, none
 * goes to /messages, and nothing in the result is a secret.
 */
const TOKEN = 'EAAG_readiness_token_not_real_0123456789'
const SECRET = 'app-secret-not-real'
const ENV = {
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_WABA_ID: '2000000000002',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN,
  META_APP_ID: '962521689620138',
  META_APP_SECRET: SECRET,
  OWNER_WA_REMINDERS_AGENCY_IDS: '103',
}
const good = {
  debug: { data: { is_valid: true, type: 'SYSTEM_USER', app_id: '962521689620138', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'], granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['2000000000002'] }] } },
  phone: { status: 'CONNECTED', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_250', name_status: 'AVAILABLE_WITHOUT_REVIEW', health_status: { can_send_message: 'AVAILABLE' } },
  template: { data: [{ name: 'lead_followup_alert', language: 'he', status: 'APPROVED', category: 'UTILITY', components: [
    { type: 'BODY', text: 'עדכון מ-SocialCRM: יש ליד שממתין למענה שלך כבר {{1}}. אפשר להמשיך את השיחה ישירות ב-SocialCRM.' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'פתיחת השיחה', url: 'https://getsocialcrm.com/inbox?conversation={{1}}' }] },
  ] }] },
}

function mockGraph(over: Partial<typeof good> = {}) {
  const r = { ...good, ...over }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    const body = u.includes('debug_token') ? r.debug : u.includes('message_templates') ? r.template : r.phone
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

beforeEach(() => Object.assign(process.env, ENV))
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('readiness (read-only)', () => {
  it('all checks pass on a ready setup; every request is a GET and none sends', async () => {
    const spy = mockGraph()
    const result = await checkOwnerReminderReadiness()
    expect(result.checks.map((c) => [c.name, c.ok])).toEqual([['config', true], ['token', true], ['phone', true], ['template', true]])
    expect(result.ready).toBe(true)
    expect(spy).toHaveBeenCalledTimes(3)
    for (const [url, init] of spy.mock.calls) {
      expect((init as RequestInit).method).toBe('GET')
      expect(String(url)).not.toMatch(/\/messages(\?|$)/)
    }
  })

  it('the result contains no token or secret', async () => {
    mockGraph()
    const text = JSON.stringify(await checkOwnerReminderReadiness())
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(SECRET)
  })

  it.each([
    ['token', { debug: { data: { ...good.debug.data, type: 'USER' } } }],
    ['token', { debug: { data: { ...good.debug.data, granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['999'] }] } } }],
    ['phone', { phone: { ...good.phone, health_status: { can_send_message: 'BLOCKED' } } }],
    ['phone', { phone: { ...good.phone, quality_rating: 'RED' } }],
    ['template', { template: { data: [{ ...good.template.data[0], status: 'PENDING' }] } }],
    ['template', { template: { data: [{ ...good.template.data[0], category: 'MARKETING' }] } }],
    ['template', { template: { data: [] } }],
  ])('a failing %s check makes it not ready', async (name, over) => {
    mockGraph(over as never)
    const result = await checkOwnerReminderReadiness()
    expect(result.ready).toBe(false)
    expect(result.checks.find((c) => c.name === name)?.ok).toBe(false)
  })

  // The entity mix Meta returned for the platform number on 2026-10-12 (ids are fixtures).
  const limitedHealth = {
    can_send_message: 'LIMITED',
    entities: [
      { entity_type: 'PHONE_NUMBER', id: '1000000000001', can_send_message: 'LIMITED', can_receive_call_sip: 'BLOCKED',
        errors: [{ error_code: 138024, error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled' }],
        additional_info: ['Your display name has not been approved yet. Your message limit will increase after the display name is approved.'] },
      { entity_type: 'WABA', id: '2000000000002', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', id: '3000000000003', can_send_message: 'LIMITED', errors: [{ error_code: 141010, error_description: 'The Business has not passed business verification.' }] },
      { entity_type: 'APP', id: '962521689620138', can_send_message: 'AVAILABLE', can_receive_call_sip: 'BLOCKED', errors: [{ error_code: 138025 }] },
    ],
  }

  it('LIMITED (unverified business, unapproved display name) can still send: ready, with the reasons reported', async () => {
    mockGraph({ phone: { ...good.phone, health_status: limitedHealth } } as never)
    const result = await checkOwnerReminderReadiness()
    expect(result.ready).toBe(true)
    const phone = result.checks.find((c) => c.name === 'phone')!
    expect(phone.ok).toBe(true)
    expect(phone.detail).toMatchObject({ canSendMessage: 'LIMITED', limited: true })
    expect(phone.detail.limitedBy).toEqual([
      { entity: 'PHONE_NUMBER', id: '1000000000001', canSendMessage: 'LIMITED', errorCodes: [138024], info: [limitedHealth.entities[0].additional_info![0]] },
      { entity: 'BUSINESS', id: '3000000000003', canSendMessage: 'LIMITED', errorCodes: [141010], info: [] },
    ])
  })

  it('BLOCKED never passes, and its reasons are reported too', async () => {
    const blocked = { can_send_message: 'BLOCKED', entities: [{ entity_type: 'WABA', id: '2000000000002', can_send_message: 'BLOCKED', errors: [{ error_code: 368 }] }] }
    mockGraph({ phone: { ...good.phone, health_status: blocked } } as never)
    const phone = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone')!
    expect(phone.ok).toBe(false)
    expect(phone.detail.limitedBy).toEqual([{ entity: 'WABA', id: '2000000000002', canSendMessage: 'BLOCKED', errorCodes: [368], info: [] }])
  })

  it('AVAILABLE is not marked limited; calling-only blocks are ignored', () => {
    expect(healthLimitations({ can_send_message: 'AVAILABLE', entities: [{ entity_type: 'APP', id: '1', can_send_message: 'AVAILABLE', can_receive_call_sip: 'BLOCKED' }] })).toEqual([])
    expect(healthLimitations(null)).toEqual([])
  })

  it('without configuration it makes no Graph call at all', async () => {
    delete process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN
    const spy = mockGraph()
    const result = await checkOwnerReminderReadiness()
    expect(result.ready).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
