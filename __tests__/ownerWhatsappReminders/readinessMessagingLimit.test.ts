import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkOwnerReminderReadiness } from '@/lib/whatsapp/platform/readiness'

/**
 * Meta deprecated the phone-number field `messaging_limit_tier`; the readiness
 * check must request `whatsapp_business_manager_messaging_limit` instead, while
 * keeping the `messagingLimitTier` detail key the admin view reads.
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
const template = { data: [] }
const basePhone = { status: 'CONNECTED', quality_rating: 'GREEN', name_status: 'AVAILABLE_WITHOUT_REVIEW', health_status: { can_send_message: 'AVAILABLE' } }

function mockGraph(phone: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    const body = u.includes('debug_token') ? debug : u.includes('message_templates') ? template : phone
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

function phoneCall(spy: ReturnType<typeof mockGraph>) {
  const call = spy.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith(`/${ENV.PLATFORM_WHATSAPP_PHONE_NUMBER_ID}`))
  expect(call).toBeDefined()
  return { url: new URL(String(call![0])), init: call![1] as RequestInit }
}

beforeEach(() => Object.assign(process.env, ENV))
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('readiness phone messaging limit field', () => {
  it('requests the new field, not the deprecated one, with a GET', async () => {
    const spy = mockGraph({ ...basePhone, whatsapp_business_manager_messaging_limit: 'TIER_250' })
    await checkOwnerReminderReadiness()
    const { url, init } = phoneCall(spy)
    const fields = (url.searchParams.get('fields') ?? '').split(',')
    expect(fields).toContain('whatsapp_business_manager_messaging_limit')
    expect(fields).not.toContain('messaging_limit_tier')
    expect(init.method).toBe('GET')
  })

  it('maps the new field onto the unchanged messagingLimitTier detail key', async () => {
    mockGraph({ ...basePhone, whatsapp_business_manager_messaging_limit: 'TIER_250' })
    const phone = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone') as any
    expect(phone.detail.messagingLimitTier).toBe('TIER_250')
  })

  it('ignores a stale deprecated messaging_limit_tier in the response', async () => {
    mockGraph({ ...basePhone, whatsapp_business_manager_messaging_limit: 'TIER_250', messaging_limit_tier: 'TIER_1K' })
    const phone = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone') as any
    expect(phone.detail.messagingLimitTier).toBe('TIER_250')
  })

  it('the phone ok outcome does not depend on the messaging limit field', async () => {
    for (const limit of ['TIER_250', undefined]) {
      vi.restoreAllMocks()
      mockGraph(limit ? { ...basePhone, whatsapp_business_manager_messaging_limit: limit } : basePhone)
      const phone = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone')
      expect(phone?.ok).toBe(true)
    }
  })
})
