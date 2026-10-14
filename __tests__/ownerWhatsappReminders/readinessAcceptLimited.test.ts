import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOwnerReminderReadiness } from '@/lib/whatsapp/platform/readiness'

/**
 * Phone readiness accepts can_send_message LIMITED (Meta: "meets messaging
 * requirements, but has some limitations"); BLOCKED still fails. The reasons
 * for LIMITED/BLOCKED come from the existing `healthEntities` diagnostics.
 */
const ENV = {
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_WABA_ID: '2000000000002',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_readiness_token_not_real_0123456789',
  META_APP_ID: '962521689620138',
  META_APP_SECRET: 'app-secret-not-real',
  OWNER_WA_REMINDERS_AGENCY_IDS: '103',
}
const debug = { data: { is_valid: true, type: 'SYSTEM_USER', app_id: '962521689620138', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'], granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['2000000000002'] }] } }
const template = { data: [{ name: 'lead_followup_alert', language: 'he', status: 'APPROVED', category: 'UTILITY', components: [
  { type: 'BODY', text: 'עדכון מ-SocialCRM: יש ליד שממתין למענה שלך כבר {{1}}. אפשר להמשיך את השיחה ישירות ב-SocialCRM.' },
  { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'פתיחת השיחה', url: 'https://getsocialcrm.com/inbox?conversation={{1}}' }] },
] }] }

/** The entity mix observed for a LIMITED number (unverified business, display name not yet approved). */
const limitedHealth = {
  can_send_message: 'LIMITED',
  entities: [
    {
      entity_type: 'PHONE_NUMBER', id: '1000000000001', can_send_message: 'LIMITED',
      additional_info: ['Your display name has not been approved yet. Your message will be delivered with your phone number only.'],
      can_receive_call_sip: 'BLOCKED',
      errors: [{ error_code: 138024, error_description: 'SIP not enabled', possible_solution: 'Enable SIP' }],
    },
    { entity_type: 'WABA', id: '2000000000002', can_send_message: 'AVAILABLE' },
    {
      entity_type: 'BUSINESS', id: '3000000000003', can_send_message: 'LIMITED',
      errors: [{ error_code: 141010, error_description: 'Business not verified', possible_solution: 'Verify your business' }],
    },
    {
      entity_type: 'APP', id: '962521689620138', can_send_message: 'AVAILABLE', can_receive_call_sip: 'BLOCKED',
      errors: [{ error_code: 138025, error_description: 'SIP blocked', possible_solution: 'n/a' }],
    },
  ],
}

const phone = (over: Record<string, unknown> = {}) => ({
  status: 'CONNECTED', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_250', name_status: 'PENDING_REVIEW', health_status: { can_send_message: 'AVAILABLE' }, ...over,
})

function mockGraph(phoneBody: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    const body = u.includes('debug_token') ? debug : u.includes('message_templates') ? template : phoneBody
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

async function phoneCheck(phoneBody: unknown) {
  mockGraph(phoneBody)
  const result = await checkOwnerReminderReadiness()
  return { result, phone: result.checks.find((c) => c.name === 'phone')! }
}

beforeEach(() => Object.assign(process.env, ENV))
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('phone readiness: LIMITED passes, BLOCKED fails', () => {
  it('LIMITED with the real entity mix passes and lists its reasons in healthEntities', async () => {
    const { result, phone: p } = await phoneCheck(phone({ health_status: limitedHealth }))
    expect(p.ok).toBe(true)
    expect(p.detail.canSendMessage).toBe('LIMITED')
    expect(result.checks.map((c) => [c.name, c.ok])).toEqual([['config', true], ['token', true], ['phone', true], ['template', true]])
    expect(result.ready).toBe(true)
    expect(p.detail.healthEntities).toEqual([
      { entity: 'PHONE_NUMBER', canSendMessage: 'LIMITED', errorCodes: [138024] },
      { entity: 'BUSINESS', canSendMessage: 'LIMITED', errorCodes: [141010] },
    ])
  })

  it('BLOCKED fails and lists the blocking entity', async () => {
    const { result, phone: p } = await phoneCheck(phone({
      health_status: { can_send_message: 'BLOCKED', entities: [
        { entity_type: 'WABA', id: '2000000000002', can_send_message: 'BLOCKED', errors: [{ error_code: 141006, error_description: 'payment' }] },
        { entity_type: 'APP', id: '962521689620138', can_send_message: 'AVAILABLE' },
      ] },
    }))
    expect(p.ok).toBe(false)
    expect(result.ready).toBe(false)
    expect(p.detail.healthEntities).toEqual([{ entity: 'WABA', canSendMessage: 'BLOCKED', errorCodes: [141006] }])
  })

  it('AVAILABLE passes', async () => {
    const { result, phone: p } = await phoneCheck(phone())
    expect(p.ok).toBe(true)
    expect(result.ready).toBe(true)
    expect(p.detail.healthEntities).toEqual([])
  })

  it.each(['LIMITED', 'AVAILABLE'])('RED quality fails even when can_send_message is %s', async (canSend) => {
    const health = canSend === 'LIMITED' ? limitedHealth : { can_send_message: 'AVAILABLE' }
    const { result, phone: p } = await phoneCheck(phone({ quality_rating: 'RED', health_status: health }))
    expect(p.ok).toBe(false)
    expect(result.ready).toBe(false)
  })

  it.each(['DISCONNECTED', 'PENDING', 'FLAGGED'])('status %s fails even when LIMITED', async (status) => {
    const { result, phone: p } = await phoneCheck(phone({ status, health_status: limitedHealth }))
    expect(p.ok).toBe(false)
    expect(result.ready).toBe(false)
  })
})
