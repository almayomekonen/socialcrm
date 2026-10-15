import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { graphErrorMeta, healthEntityDiagnostics, scopeGrantOnWaba, tokenUserIdFrom } from '@/lib/whatsapp/platform/readinessDiagnostics'
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

describe('tokenUserIdFrom', () => {
  it('keeps a 5-20 digit id, as a string', () => {
    expect(tokenUserIdFrom('61595338681240')).toBe('61595338681240')
    expect(tokenUserIdFrom(61595338681240)).toBe('61595338681240')
  })
  it('drops anything that is not a plain numeric id', () => {
    for (const v of [undefined, null, '', '1234', '1'.repeat(21), '6159533868124O', ' 61595338681240', 'EAAG_token_like_value_0123456789', -61595338681240, 1.5, { id: '61595338681240' }])
      expect(tokenUserIdFrom(v)).toBeNull()
  })
})

describe('scopeGrantOnWaba', () => {
  const M = 'whatsapp_business_management'
  it('GRANTED only when the WABA is in the scope\'s target_ids', () => {
    expect(scopeGrantOnWaba([{ scope: M, target_ids: [WABA] }], M, WABA)).toBe('GRANTED')
    expect(scopeGrantOnWaba([{ scope: M, target_ids: [Number(WABA)] }], M, WABA)).toBe('GRANTED')
  })
  it('UNKNOWN, never GRANTED, when the scope carries no target_ids', () => {
    expect(scopeGrantOnWaba([{ scope: M }], M, WABA)).toBe('UNKNOWN')
    expect(scopeGrantOnWaba([{ scope: M, target_ids: null }], M, WABA)).toBe('UNKNOWN')
    expect(scopeGrantOnWaba([{ scope: M, target_ids: WABA }], M, WABA)).toBe('UNKNOWN')
  })
  it('UNKNOWN when granular_scopes is missing or malformed', () => {
    expect(scopeGrantOnWaba(undefined, M, WABA)).toBe('UNKNOWN')
    expect(scopeGrantOnWaba({ scope: M }, M, WABA)).toBe('UNKNOWN')
  })
  it('NOT_GRANTED when the scope is absent or targets other assets only', () => {
    expect(scopeGrantOnWaba([{ scope: M, target_ids: ['999'] }], M, WABA)).toBe('NOT_GRANTED')
    expect(scopeGrantOnWaba([{ scope: M, target_ids: [] }], M, WABA)).toBe('NOT_GRANTED')
    expect(scopeGrantOnWaba([{ scope: 'whatsapp_business_messaging', target_ids: [WABA] }], M, WABA)).toBe('NOT_GRANTED')
    expect(scopeGrantOnWaba([], M, WABA)).toBe('NOT_GRANTED')
  })
})

describe('through checkOwnerReminderReadiness (Graph mocked)', () => {
  const ENV = { PLATFORM_WHATSAPP_PHONE_NUMBER_ID: PHONE_ID, PLATFORM_WHATSAPP_WABA_ID: WABA, PLATFORM_WHATSAPP_ACCESS_TOKEN: 'EAAG_diag_token_not_real_0123456789', META_APP_ID: '962521689620138', META_APP_SECRET: 'diag-app-secret-not-real' }
  const debug = { data: { is_valid: true, type: 'SYSTEM_USER', app_id: '962521689620138', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: [WABA] }, { scope: 'whatsapp_business_management', target_ids: ['5550000000000'] }] } }
  const phone = { status: 'CONNECTED', quality_rating: 'GREEN', name_status: 'AVAILABLE_WITHOUT_REVIEW', messaging_limit_tier: 'TIER_250', health_status: blockedHealth }
  const templateError = { error: { code: 100, error_subcode: 33, type: 'GraphMethodException', fbtrace_id: 'AtraceID_123', message: PROVIDER_TEXT } }

  function mockGraph(over: { phone?: unknown; debug?: unknown } = {}) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('debug_token')) return new Response(JSON.stringify(over.debug ?? debug), { status: 200 })
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
    expect(token.detail).toMatchObject({ messagingGrantedOnWaba: 'GRANTED', managementGrantedOnWaba: 'NOT_GRANTED' })
    expect(token.detail.scopes).toContain('whatsapp_business_management')
  })

  it('a scope without target_ids is UNKNOWN, not GRANTED, and the token check fails on it', async () => {
    const untargeted = { data: { ...debug.data, granular_scopes: [{ scope: 'whatsapp_business_messaging' }, { scope: 'whatsapp_business_management' }] } }
    mockGraph({ debug: untargeted })
    const token = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'token')!
    expect(token.detail).toMatchObject({ messagingGrantedOnWaba: 'UNKNOWN', managementGrantedOnWaba: 'UNKNOWN' })
    expect(token.ok).toBe(false)
  })

  it('reports the token\'s System User id from debug_token, digits only', async () => {
    mockGraph({ debug: { data: { ...debug.data, user_id: '61595338681240' } } })
    const token = (await checkOwnerReminderReadiness()).checks.find((c) => c.name === 'token')!
    expect(token.detail.tokenUserId).toBe('61595338681240')
    expect(token.ok).toBe(true)
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
