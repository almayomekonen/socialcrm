import { describe, expect, it } from 'vitest'
import { toReadinessView } from '@/lib/whatsapp/platform/readinessView'

/** Only allowlisted, coerced fields survive: no token, secret, raw Meta data or Meta error text. */
const TOKEN = 'EAAG_view_test_token_not_real_0123456789'

const result = {
  ready: false,
  checks: [
    { name: 'config', ok: true, detail: { phoneNumberId: true, wabaId: true, accessToken: true, appId: true, appSecret: true, sendEnabled: false, allowlistedAgencies: [103], token: TOKEN } },
    { name: 'token', ok: true, detail: { isValid: true, type: 'SYSTEM_USER', appMatches: true, neverExpires: true, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management', 'public_profile'], messagingGrantedOnWaba: 'GRANTED', input_token: TOKEN } },
    { name: 'phone', ok: false, detail: { status: 'CONNECTED', qualityRating: 'GREEN', canSendMessage: 'LIMITED', nameStatus: 'AVAILABLE_WITHOUT_REVIEW', messagingLimitTier: 'TIER_250', raw: { display_phone_number: '+972 54-922-1572' } } },
    { name: 'template', ok: false, detail: { httpStatus: 400, code: 100, message: `Invalid OAuth access token ${TOKEN}` } },
    { name: 'unknown_future_check', ok: true, detail: { secret: TOKEN } },
  ],
}

describe('toReadinessView', () => {
  it('shows the token\'s System User id only as a 5-20 digit string', () => {
    const view = (tokenUserId: unknown) => toReadinessView({ ready: false, checks: [{ name: 'token', ok: false, detail: { tokenUserId } }] }).checks[0].fields
    expect(view('61595338681240')).toEqual([{ key: 'tokenUserId', label: expect.any(String), value: '61595338681240' }])
    for (const bad of ['EAAG_token_like_value_0123456789', '61595338681240 ', '<b>1</b>', '1234', 61595338681240, null]) expect(view(bad)).toEqual([])
  })

  it('shows the /me id and name only when they pass the allowlist', () => {
    const view = (detail: Record<string, unknown>) => toReadinessView({ ready: false, checks: [{ name: 'token', ok: false, detail }] }).checks[0].fields.map((f) => [f.key, f.value])
    expect(view({ tokenMeId: '122099730999511289', tokenUserName: 'Socialcrm Intelligence' })).toEqual([['tokenMeId', '122099730999511289'], ['tokenUserName', 'Socialcrm Intelligence']])
    expect(view({ tokenMeId: TOKEN, tokenUserName: `<img src=x> ${TOKEN}` })).toEqual([])
    expect(view({ meHttpStatus: 400, meCode: 100, meErrorSubcode: 33, message: 'Unsupported get request' })).toEqual([['meHttpStatus', 400], ['meCode', 100], ['meErrorSubcode', 33]])
    expect(view({ meHttpStatus: '400', meCode: 'x' })).toEqual([])
  })

  it('shows ALL_TARGETS as its own grant value, and the WABA read only as a boolean', () => {
    const v = toReadinessView({ ready: false, checks: [{ name: 'token', ok: true, detail: { messagingGrantedOnWaba: 'ALL_TARGETS', wabaReadable: true } }] })
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([['messagingGrantedOnWaba', 'ALL_TARGETS'], ['wabaReadable', true]])
    const w = toReadinessView({ ready: false, checks: [{ name: 'token', ok: true, detail: { wabaReadable: 'yes' } }] })
    expect(w.checks[0].fields).toEqual([])
  })

  it('shows each WABA grant as GRANTED, NOT_GRANTED or UNKNOWN; booleans and anything else are not trusted', () => {
    const v = toReadinessView({ ready: false, checks: [{ name: 'token', ok: true, detail: { messagingGrantedOnWaba: 'UNKNOWN', managementGrantedOnWaba: true } }] })
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([['messagingGrantedOnWaba', 'UNKNOWN'], ['managementGrantedOnWaba', 'UNEXPECTED']])
    const w = toReadinessView({ ready: false, checks: [{ name: 'token', ok: true, detail: { managementGrantedOnWaba: '2060714354527399' } }] })
    expect(JSON.stringify(w)).not.toContain('2060714354527399')
  })

  it('audience all: shows it as a boolean with the excluded count, and no allowlist count', () => {
    const v = toReadinessView({ ready: false, checks: [{ name: 'config', ok: true, detail: { audienceAll: true, allowlistedAgencies: [], excludedAgencyCount: 1 } }] })
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([['audienceAll', true], ['excludedAgencyCount', 1]])
    const w = toReadinessView({ ready: false, checks: [{ name: 'config', ok: true, detail: { audienceAll: false, allowlistedAgencies: [103], excludedAgencyCount: 1 } }] })
    expect(w.checks[0].fields.map((f) => [f.key, f.value])).toEqual([['audienceAll', false], ['allowlistedAgencyCount', 1], ['excludedAgencyCount', 1]])
  })

  it('keeps only allowlisted fields, in order, with booleans, enums and integers', () => {
    const v = toReadinessView(result)
    expect(v.checks.map((c) => [c.name, c.ok])).toEqual([['config', true], ['token', true], ['phone', false], ['template', false]])
    expect(v.checks[0].fields.map((f) => [f.key, f.value])).toEqual([
      ['phoneNumberId', true], ['wabaId', true], ['accessToken', true], ['appId', true], ['appSecret', true], ['sendEnabled', false], ['allowlistedAgencyCount', 1],
    ])
    expect(v.checks[1].fields.map((f) => [f.key, f.value])).toEqual([
      ['isValid', true], ['type', 'SYSTEM_USER'], ['appMatches', true], ['neverExpires', true], ['hasMessagingScope', true], ['hasManagementScope', true], ['messagingGrantedOnWaba', 'GRANTED'],
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

  it('renders the new diagnostics, filtered: subcode, type, trace id, management grant and blocked entities', () => {
    const v = toReadinessView({
      ready: false,
      checks: [
        { name: 'token', ok: true, detail: { isValid: true, managementGrantedOnWaba: 'NOT_GRANTED' } },
        { name: 'phone', ok: false, detail: { canSendMessage: 'BLOCKED', healthEntities: [
          { entity: 'WABA', canSendMessage: 'BLOCKED', errorCodes: [141006] },
          { entity: 'BUSINESS', canSendMessage: 'LIMITED', errorCodes: [] },
          { entity: 'APP', canSendMessage: 'AVAILABLE', errorCodes: [1] },
          { entity: 'bad id 2060714354527399', canSendMessage: 'BLOCKED', errorCodes: ['x', 7], id: '2060714354527399', description: 'payment failed' },
        ] } },
        { name: 'template', ok: false, detail: { httpStatus: 400, code: 100, errorSubcode: 33, errorType: 'GraphMethodException', fbtraceId: 'AtraceID_123', message: 'Unsupported get request 2060714354527399' } },
      ],
    })
    const token = v.checks.find((c) => c.name === 'token')!
    expect(token.fields.find((f) => f.key === 'managementGrantedOnWaba')?.value).toBe('NOT_GRANTED')
    const phone = v.checks.find((c) => c.name === 'phone')!
    expect(phone.fields.filter((f) => f.key.startsWith('health_')).map((f) => [f.label, f.value])).toEqual([
      ['מצב שליחה: WABA', 'BLOCKED (141006)'],
      ['מצב שליחה: BUSINESS', 'LIMITED'],
      ['מצב שליחה: UNEXPECTED', 'BLOCKED (7)'],
    ])
    const tpl = v.checks.find((c) => c.name === 'template')!
    expect(tpl.fields.map((f) => [f.key, f.value])).toEqual([['httpStatus', 400], ['code', 100], ['errorSubcode', 33], ['errorType', 'GraphMethodException'], ['fbtraceId', 'AtraceID_123']])
    const text = JSON.stringify(v)
    for (const s of ['2060714354527399', 'payment failed', 'Unsupported', 'description']) expect(text).not.toContain(s)
  })

  it('drops diagnostics of the wrong shape', () => {
    const v = toReadinessView({ ready: false, checks: [{ name: 'template', ok: false, detail: { errorSubcode: '33', errorType: 'Bad Type!', fbtraceId: 'x' } }] })
    expect(v.checks[0].fields).toEqual([])
  })
})

