import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isCoexistenceWebhookField,
  resolvePhoneNumberIdForWaba,
  syncSmbAppData,
  fetchPhoneBizAppState,
  resolveOnboardingType,
  processCoexistenceWebhook,
  HISTORY_SYNC_ENABLED,
} from '@/lib/whatsapp/coexistence'

const originalFetch = global.fetch

function mockFetchOnce(responses: Array<{ ok: boolean; body?: unknown; status?: number }>) {
  const fn = vi.fn()
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      json: async () => r.body ?? {},
    })
  }
  global.fetch = fn as unknown as typeof fetch
  return fn
}

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('isCoexistenceWebhookField', () => {
  it('identifies the three coexistence fields', () => {
    expect(isCoexistenceWebhookField('smb_message_echoes')).toBe(true)
    expect(isCoexistenceWebhookField('history')).toBe(true)
    expect(isCoexistenceWebhookField('smb_app_state_sync')).toBe(true)
  })

  // The guard must never swallow real inbound traffic — that would silently
  // stop every lead, which is worse than the bug this feature fixes.
  it('does not match the inbound messages field', () => {
    expect(isCoexistenceWebhookField('messages')).toBe(false)
  })

  it('does not match template lifecycle fields', () => {
    expect(isCoexistenceWebhookField('message_template_status_update')).toBe(false)
    expect(isCoexistenceWebhookField('message_template_quality_update')).toBe(false)
  })

  it('is safe against missing or non-string fields', () => {
    expect(isCoexistenceWebhookField(undefined)).toBe(false)
    expect(isCoexistenceWebhookField(null)).toBe(false)
    expect(isCoexistenceWebhookField(42)).toBe(false)
    expect(isCoexistenceWebhookField({})).toBe(false)
  })
})

describe('resolvePhoneNumberIdForWaba', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('resolves when the WABA has exactly one phone number', async () => {
    mockFetchOnce([{ ok: true, body: { data: [{ id: '111', display_phone_number: '+972 50-000-0000' }] } }])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ phoneNumberId: '111' })
  })

  it('reports none_found for an empty list', async () => {
    mockFetchOnce([{ ok: true, body: { data: [] } }])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ reason: 'none_found' })
  })

  // Guessing would silently wire the CRM to a number the business does not use
  // for leads, and the mistake would surface only as missing leads later.
  it('refuses to guess when several numbers exist and none is on the Business app', async () => {
    mockFetchOnce([{ ok: true, body: { data: [{ id: '111' }, { id: '222' }] } }])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ reason: 'ambiguous' })
  })

  it('resolves the Coexistence number when a multi-phone WABA has exactly one is_on_biz_app=true', async () => {
    mockFetchOnce([
      {
        ok: true,
        body: {
          data: [
            { id: '111', platform_type: 'CLOUD_API', is_on_biz_app: false },
            { id: '222', platform_type: 'CLOUD_API', is_on_biz_app: true },
            { id: '333', platform_type: 'CLOUD_API', is_on_biz_app: false },
          ],
        },
      },
    ])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ phoneNumberId: '222' })
  })

  it('stays ambiguous when several numbers are on the Business app', async () => {
    mockFetchOnce([
      {
        ok: true,
        body: {
          data: [
            { id: '111', is_on_biz_app: true },
            { id: '222', is_on_biz_app: true },
          ],
        },
      },
    ])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ reason: 'ambiguous' })
  })

  it('ignores rows without an id', async () => {
    mockFetchOnce([{ ok: true, body: { data: [{ display_phone_number: 'x' }, { id: '333' }] } }])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ phoneNumberId: '333' })
  })

  it('reports lookup_failed on a non-OK response', async () => {
    mockFetchOnce([{ ok: false, status: 400 }])
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ reason: 'lookup_failed' })
  })

  it('never throws when the network fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    await expect(resolvePhoneNumberIdForWaba('WABA', 'TOKEN')).resolves.toEqual({ reason: 'lookup_failed' })
  })

  it('does not leak the access token into the query path segment', async () => {
    const fn = mockFetchOnce([{ ok: true, body: { data: [{ id: '111' }] } }])
    await resolvePhoneNumberIdForWaba('WABA', 'a b&c')
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('a%20b%26c')
    expect(url).toContain('is_on_biz_app')
    expect(url).not.toContain('/v19.0/')
  })
})

describe('resolveOnboardingType', () => {
  it('forces coexistence when is_on_biz_app is true, ignoring the browser type', () => {
    expect(resolveOnboardingType({ isOnBizApp: true, browserOnboardingType: 'cloud_api' })).toBe('coexistence')
  })

  it('keeps the coexistence hint when Graph has not flipped the flag yet', () => {
    expect(resolveOnboardingType({ isOnBizApp: false, browserOnboardingType: 'coexistence' })).toBe('coexistence')
  })

  it('stays Cloud API when Graph and the browser both say so', () => {
    expect(resolveOnboardingType({ isOnBizApp: false, browserOnboardingType: 'cloud_api' })).toBe('cloud_api')
    expect(resolveOnboardingType({ isOnBizApp: false })).toBe('cloud_api')
  })

  it('an existing Coexistence connection stays Coexistence whatever Meta or the browser says', () => {
    for (const isOnBizApp of [true, false])
      for (const browserOnboardingType of ['cloud_api', 'coexistence', undefined] as const)
        expect(resolveOnboardingType({ isOnBizApp, browserOnboardingType, existingOnboardingType: 'coexistence' })).toBe('coexistence')
  })

  it('an existing Cloud API (or legacy null) row is resolved exactly as before', () => {
    for (const existingOnboardingType of ['cloud_api', null, undefined]) {
      expect(resolveOnboardingType({ isOnBizApp: false, browserOnboardingType: 'cloud_api', existingOnboardingType })).toBe('cloud_api')
      expect(resolveOnboardingType({ isOnBizApp: true, browserOnboardingType: 'cloud_api', existingOnboardingType })).toBe('coexistence')
      expect(resolveOnboardingType({ isOnBizApp: false, browserOnboardingType: 'coexistence', existingOnboardingType })).toBe('coexistence')
    }
  })
})

describe('fetchPhoneBizAppState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns isOnBizApp true only for the boolean true flag', async () => {
    mockFetchOnce([{ ok: true, body: { is_on_biz_app: true, platform_type: 'CLOUD_API' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({
      isOnBizApp: true,
      known: true,
      platformType: 'CLOUD_API',
    })
  })

  it('an explicit false is a known Cloud API answer', async () => {
    mockFetchOnce([{ ok: true, body: { is_on_biz_app: false, platform_type: 'CLOUD_API' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({
      isOnBizApp: false,
      known: true,
      platformType: 'CLOUD_API',
    })
  })

  it('a missing or non-boolean flag is not "on the Business app", but it is UNKNOWN, never a known false', async () => {
    mockFetchOnce([{ ok: true, body: { platform_type: 'CLOUD_API' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({
      isOnBizApp: false,
      known: false,
      platformType: 'CLOUD_API',
    })
    mockFetchOnce([{ ok: true, body: { is_on_biz_app: 'true' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toMatchObject({ isOnBizApp: false, known: false })
  })

  it('requests the documented fields on the coexistence Graph version', async () => {
    const fn = mockFetchOnce([{ ok: true, body: { is_on_biz_app: false } }])
    await fetchPhoneBizAppState('106540352242922', 'tok')
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('/106540352242922?')
    expect(url).toContain('fields=is_on_biz_app,platform_type')
    expect(url).not.toContain('/v19.0/')
  })

  it('never throws when the lookup fails', async () => {
    mockFetchOnce([{ ok: false, status: 400 }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({ isOnBizApp: false, known: false })
  })
})

describe('processCoexistenceWebhook', () => {
  // Async since Wave 2A.1: the echo branch persists. History and state_sync
  // still only acknowledge, which is exactly what these assertions pin.
  it('acknowledges each coexistence field', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(processCoexistenceWebhook('history', { history: [] })).resolves.toEqual({
      ok: true,
      field: 'history',
    })
    await expect(processCoexistenceWebhook('smb_app_state_sync', {})).resolves.toEqual({
      ok: true,
      field: 'smb_app_state_sync',
    })
    // An echo payload carrying no phone_number_id is refused before any DB access.
    await expect(processCoexistenceWebhook('smb_message_echoes', {})).resolves.toEqual({
      ok: true,
      field: 'smb_message_echoes',
    })
  })
})

describe('syncSmbAppData', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  /**
   * WAVE 2A.0 — the history gate.
   *
   * These assertions were rewritten, not added beside the originals. The old
   * ones asserted that `sync_type:'history'` IS requested, which is now exactly
   * the behaviour that must never happen: the webhook discards the reply, and
   * Meta's history sync is one-time and non-repeatable, so asking for it
   * destroys the customer's archive permanently.
   *
   * Leaving the originals in place beside a gate test would have meant a suite
   * that passes whichever way the gate is set.
   */
  it('1 · still requests contacts', async () => {
    const fn = mockFetchOnce([{ ok: true, body: { success: true } }])
    const result = await syncSmbAppData('PHONE', 'TOKEN')

    expect(result.contacts).toBe(true)
    expect(JSON.parse(String(fn.mock.calls[0][1].body)).sync_type).toBe('smb_app_state_sync')
  })

  it("2 · NEVER requests sync_type:'history' while the gate holds", async () => {
    const fn = mockFetchOnce([
      { ok: true, body: { success: true } },
      { ok: true, body: { success: true } },
    ])
    const result = await syncSmbAppData('PHONE', 'TOKEN')

    // Exactly one call — contacts. The archive is left unspent with Meta.
    expect(fn).toHaveBeenCalledTimes(1)
    for (const call of fn.mock.calls) {
      expect(JSON.parse(String(call[1].body)).sync_type).not.toBe('history')
    }
    expect(result.historyRequested).toBe(false)
    expect(result.history).toBe(false)
  })

  it('3 · coexistence setup still completes — contacts succeed and nothing throws', async () => {
    mockFetchOnce([{ ok: true, body: { success: true } }])
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({
      contacts: true,
      history: false,
      historyRequested: false,
    })
  })

  it('4 · a gated history is NOT reported as a failed sync', async () => {
    mockFetchOnce([{ ok: true, body: { success: true } }])
    const result = await syncSmbAppData('PHONE', 'TOKEN')
    // `historyRequested:false` is what lets the caller tell a deliberate
    // omission from a real failure, so onboarding does not warn every time.
    expect(result.historyRequested && !result.history).toBe(false)
  })

  it('6 · the gate is deterministic — repeated calls never request history', async () => {
    for (let i = 0; i < 3; i++) {
      const fn = mockFetchOnce([{ ok: true, body: { success: true } }])
      const result = await syncSmbAppData('PHONE', 'TOKEN')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(result.historyRequested).toBe(false)
    }
  })

  it('the gate is a code constant, not an environment flag', () => {
    // An env var can be flipped by someone unaware of the consequences, and the
    // loss is irreversible per customer. Lifting it must show up in a diff — as
    // it did: the sanctioned activation commit flipped this literal to `true`.
    expect(HISTORY_SYNC_ENABLED).toBe(true)
    const src = readFileSync('lib/whatsapp/coexistence.ts', 'utf8')
    // Still a literal, not a computed or env-derived value. THIS is the property
    // the test exists to protect, and it outlives the value itself: the narrow
    // key is the per-number allowlist, never a runtime toggle on this constant.
    expect(src).toContain('export const HISTORY_SYNC_ENABLED = true')
    expect(src).not.toMatch(/HISTORY_SYNC_ENABLED\s*=\s*(process\.env|Boolean|!!)/)
  })

  // Contacts remain independent: a failed contact sync still short-circuits.
  it('does not attempt anything further when contacts fail', async () => {
    const fn = mockFetchOnce([{ ok: false, status: 500 }])
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({
      contacts: false,
      history: false,
      historyRequested: false,
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('never throws when the network fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({
      contacts: false,
      history: false,
      historyRequested: false,
    })
  })

  it('targets a Graph version that supports smb_app_data', async () => {
    const fn = mockFetchOnce([{ ok: true, body: {} }])
    await syncSmbAppData('PHONE', 'TOKEN')
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('/smb_app_data')
    expect(url).not.toContain('/v19.0/')
  })
})

/**
 * 5 · The webhook side is deliberately UNCHANGED. The gate stops us ASKING for
 * history; it must not remove the ability to RECEIVE it, or lifting the gate
 * later would require re-doing the routing work.
 */
describe('the history webhook path remains intact', () => {
  it("still recognises 'history' as a coexistence field", () => {
    expect(isCoexistenceWebhookField('history')).toBe(true)
    expect(isCoexistenceWebhookField('smb_app_state_sync')).toBe(true)
    expect(isCoexistenceWebhookField('smb_message_echoes')).toBe(true)
  })

  it('still acknowledges a history payload terminally', async () => {
    await expect(processCoexistenceWebhook('history', { history: [{ id: 'x' }] })).resolves.toEqual({
      ok: true,
      field: 'history',
    })
  })

  it('the webhook route still routes coexistence fields before inbound handling', () => {
    const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
    expect(route).toContain('isCoexistenceWebhookField(incomingField)')
    expect(route).toContain('processCoexistenceWebhook(incomingField, change?.value)')
  })
})
