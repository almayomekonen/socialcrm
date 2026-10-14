import { describe, expect, it } from 'vitest'
import { toReadinessView } from '@/lib/whatsapp/platform/readinessView'

/** Only allowlisted, coerced fields survive: no token, secret, raw Meta data or Meta error text. */
const TOKEN = 'EAAG_view_test_token_not_real_0123456789'

const result = {
  ready: false,
  checks: [
    { name: 'config', ok: true, detail: { phoneNumberId: true, wabaId: true, accessToken: true, appId: true, appSecret: true, sendEnabled: false, allowlistedAgencies: [103], token: TOKEN } },
    { name: 'token', ok: true, detail: { isValid: true, type: 'SYSTEM_USER', appMatches: true, neverExpires: true, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management', 'public_profile'], messagingGrantedOnWaba: true, input_token: TOKEN } },
    { name: 'phone', ok: false, detail: { status: 'CONNECTED', qualityRating: 'GREEN', canSendMessage: 'LIMITED', nameStatus: 'AVAILABLE_WITHOUT_REVIEW', messagingLimitTier: 'TIER_250', raw: { display_phone_number: '+972 54-922-1572' } } },
    { name: 'template', ok: false, detail: { httpStatus: 400, code: 100, message: `Invalid OAuth access token ${TOKEN}` } },
    { name: 'unknown_future_check', ok: true, detail: { secret: TOKEN } },
  ],
}

describe('toReadinessView', () => {
  it('keeps only allowlisted fields, in order, with booleans, enums and integers', () => {
    const v = toReadinessView(result)
    expect(v.checks.map((c) => [c.name, c.ok])).toEqual([['config', true], ['token', true], ['phone', false], ['template', false]])
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([
      ['phoneNumberId', true], ['wabaId', true], ['accessToken', true], ['appId', true], ['appSecret', true], ['sendEnabled', false], ['allowlistedAgencyCount', 1],
    ])
    expect(v.checks[1].fields.map((f) => [f.key, f.value])).toEqual([
      ['isValid', true], ['type', 'SYSTEM_USER'], ['appMatches', true], ['neverExpires', true], ['hasMessagingScope', true], ['hasManagementScope', true], ['messagingGrantedOnWaba', true],
    ])
    expect(v.checks[3].fields.map((f) => [f.key, f.value])).toEqual([['httpStatus', 400], ['code', 100]])
  })

  it('never carries a token, a secret, a phone number, raw Meta objects or Meta error text', () => {
    const text = JSON.stringify(toReadinessView(result))
    for (const s of [TOKEN, 'input_token', 'Invalid OAuth', '972', 'display_phone_number', 'unknown_future_check', 'public_profile']) expect(text).not.toContain(s)
  })

  it('coerces unexpected values instead of passing them through', () => {
    const v = toReadinessView({ ready: true, checks: [{ name: 'phone', ok: true, detail: { status: '<script>x</script>', qualityRating: 42, messagingLimitTier: 'tier_250' } }] })
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([['status', 'UNEXPECTED'], ['qualityRating', 'UNEXPECTED'], ['messagingLimitTier', 'UNEXPECTED']])
  })

  it('is ready only when the result says so and every rendered check passed', () => {
    expect(toReadinessView({ ready: true, checks: [{ name: 'config', ok: true, detail: {} }] }).ready).toBe(true)
    expect(toReadinessView({ ready: true, checks: [{ name: 'config', ok: false, detail: {} }] }).ready).toBe(false)
    expect(toReadinessView({ ready: true, checks: [] }).ready).toBe(false)
    expect(toReadinessView({} as never)).toEqual({ ready: false, checks: [] })
  })
})
