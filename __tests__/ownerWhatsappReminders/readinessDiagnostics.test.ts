import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphErrorMeta, healthEntityDiagnostics, managementGrantedOnWaba } from '@/lib/whatsapp/platform/readinessDiagnostics'
import { checkOwnerReminderReadiness } from '@/lib/whatsapp/platform/readiness'

/**
 * Diagnostics explain a failure without exposing ids, provider text or secrets,
 * and never change a check's pass/fail outcome.
 */
const WABA = '2000000000002'
const PHONE_ID = '1000000000001'
const PROVIDER_TEXT = 'Unsupported get request. Object with ID 2000000000002 does not exist'

const blockedHealth = {
  can_send_message: 'BLOCKED',
  entities: [
    { entity_type: 'PHONE_NUMBER', id: PHONE_ID, can_send_message: 'LIMITED', can_receive_call_sip: 'BLOCKED', errors: [{ error_code: 138024, error_description: 'SIP not enabled' }], additional_info: ['Your display name has not been approved yet.'] },
    { entity_type: 'WABA', id: WABA, can_send_message: 'BLOCKED', errors: [{ error_code: 141006, error_description: 'There is an error with the payment method' }] },
    { entity_type: 'BUSINESS', id: '3000000000003', can_send_message: 'LIMITED', errors: [{ error_code: 141010, error_description: 'The Business has not passed business verification.' }] },
    { entity_type: 'APP', id: '962521689620138', can_send_message: 'AVAILABLE', can_receive_call_sip: 'BLOCKED', errors: [{ error_code: 138025 }] },
  ],
}

describe('healthEntityDiagnostics', () => {
  it('lists LIMITED and BLOCKED entities with type, status and numeric codes only', () => {
    expect(healthEntityDiagnostics(blockedHealth)).toEqual([
      { entity: 'PHONE_NUMBER', canSendMessage: 'LIMITED', errorCodes: [138024] },
      { entity: 'WABA', canSendMessage: 'BLOCKED', errorCodes: [141006] },
      { entity: 'BUSINESS', canSendMessage: 'LIMITED', errorCodes: [141010] },
    ])
  })

  it('never carries ids, error descriptions or additional_info; malformed values are coerced', () => {
    const text = JSON.stringify(healthEntityDiagnostics(blockedHealth))
    for (const s of [PHONE_ID, WABA, '3000000000003', '962521689620138', 'payment method', 'display name', 'business verification', 'SIP']) expect(text).not.toContain(s)
    expect(healthEntityDiagnostics({ entities: [{ entity_type: 'waba<script>', can_send_message: 'BLOCKED', errors: [{ error_code: '141006' }, { error_code: 1.5 }, { error_code: 368 }] }] }))
      .toEqual([{ entity: 'UNEXPECTED', canSendMessage: 'BLOCKED', errorCodes: [368] }])
    expect(healthEntityDiagnostics(null)).toEqual([])
    expect(healthEntityDiagnostics({ entities: 'nope' })).toEqual([])
  })
})

describe('graphErrorMeta', () => {
  it('keeps subcode, type and trace id; never the message', () => {
    const meta = graphErrorMeta({ error: { code: 100, error_subcode: 33, type: 'GraphMethodException', fbtrace_id: 'AbC_12-xyz9', message: PROVIDER_TEXT } })
    expect(meta).toEqual({ errorSubcode: 33, errorType: 'GraphMethodException', fbtraceId: 'AbC_12-xyz9' })
    expect(JSON.stringify(meta)).not.toContain('Unsupported')
  })

  it('drops values that are not the expected shape', () => {
    expect(graphErrorMeta({ error: { error_subcode: '33', type: 'Graph Method <b>', fbtrace_id: 'a b' } })).toEqual({ errorSubcode: null, errorType: null, fbtraceId: null })
    expect(graphErrorMeta(null)).toEqual({ errorSubcode: null, errorType: null, fbtraceId: null })
  })
})

describe('managementGrantedOnWaba', () => {
  it('true with no target restriction or with the WABA targeted; false otherwise', () => {
    expect(managementGrantedOnWaba([{ scope: 'whatsapp_business_management' }], WABA)).toBe(true)
    expect(managementGrantedOnWaba([{ scope: 'whatsapp_business_management', target_ids: [WABA] }], WABA)).toBe(true)
    expect(managementGrantedOnWaba([{ scope: 'whatsapp_business_management', target_ids: ['999'] }], WABA)).toBe(false)
    expect(managementGrantedOnWaba([{ scope: 'whatsapp_business_messaging', target_ids: [WABA] }], WABA)).toBe(false)
    expect(managementGrantedOnWaba(undefined, WABA)).toBe(false)
  })
})

describe('through checkOwnerReminderReadiness (Graph mocked)', () => {
  const ENV = { PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, PLATFORM_WHATSAPP_WABA_ID: WABA, PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_diag_token_not_real_0123456789', META_APP_ID: '962521689620138', META_APP_SECRET: 'diag-app-secret-not-real' }
  const debug = { data: { is_valid: true, type: 'SYSTEM_USER', app_id: '962521689620138', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: [WABA] }, { scope: 'whatsapp_business_management', target_ids: ['5550000000000'] }] } }
  const phone = { status: 'CONNECTED', quality_rating: 'GREEN', name_status: 'AVAILABLE_WITHOUT_REVIEW', messaging_limit_tier: 'TIER_250', health_status: blockedHealth }
  const templateError = { error: { code: 100, error_subcode: 33, type: 'GraphMethodException', fbtrace_id: 'AtraceID_123', message: PROVIDER_TEXT } }

  function mockGraph(over: { phone?: unknown } = {}) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('debug_token')) return new Response(JSON.stringify(debug), { status: 200 })
      if (u.includes('message_templates')) return new Response(JSON.stringify(templateError), { status: 400 })
      return new Response(JSON.stringify(over.phone ?? phone), { status: 200 })
    })
  }
  beforeEach(() => Object.assign(process.env, ENV))
  afterEach(() => { vi.restoreAllMocks(); for (const k of Object.keys(ENV)) delete process.env[k] })

  it('pass/fail is unchanged: token passes, phone (BLOCKED) and template (400) fail', async () => {
    mockGraph()
    const r = await checkOwnerReminderReadiness()
    expect(r.checks.map((c) => [c.name, c.ok])).toEqual([['config', true], ['token', true], ['phone', false], ['template', false]])
    expect(r.ready).toBe(false)
  })

  it('adds management-on-WABA (false here) separately from the scope-name check', async () => {
    mockGraph()
    const token = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'token')!
    expect(token.detail).toMatchObject({ messagingGrantedOnWaba: true, managementGrantedOnWaba: false })
    expect(token.detail.scopes).toContain('whatsapp_business_management')
  })

  it('reports which entities block or limit the phone', async () => {
    mockGraph()
    const ph = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone')!
    expect(ph.detail).toMatchObject({ canSendMessage: 'BLOCKED', healthEntities: [
      { entity: 'PHONE_NUMBER', canSendMessage: 'LIMITED', errorCodes: [138024] },
      { entity: 'WABA', canSendMessage: 'BLOCKED', errorCodes: [141006] },
      { entity: 'BUSINESS', canSendMessage: 'LIMITED', errorCodes: [141010] },
    ] })
  })

  it('an AVAILABLE phone still passes and lists nothing', async () => {
    mockGraph({ phone: { ...phone, health_status: { can_send_message: 'AVAILABLE', entities: [] } } })
    const ph = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'phone')!
    expect(ph.ok).toBe(true)
    expect(ph.detail.healthEntities).toEqual([])
  })

  it('the template error carries HTTP status, code, subcode, type and trace id', async () => {
    mockGraph()
    const tpl = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'template')!
    expect(tpl.detail).toMatchObject({ httpStatus: 400, code: 100, errorSubcode: 33, errorType: 'GraphMethodException', fbtraceId: 'AtraceID_123' })
  })
})
