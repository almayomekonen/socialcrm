import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isCoexistenceWebhookField,
  resolvePhoneNumberIdForWaba,
  syncSmbAppData,
  fetchPhoneBizAppState,
  resolveOnboardingType,
  processCoexistenceWebhook,
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
})

describe('fetchPhoneBizAppState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns isOnBizApp true only for the boolean true flag', async () => {
    mockFetchOnce([{ ok: true, body: { is_on_biz_app: true, platform_type: 'CLOUD_API' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({
      isOnBizApp: true,
      platformType: 'CLOUD_API',
    })
  })

  it('does not treat a missing flag as on the Business app', async () => {
    mockFetchOnce([{ ok: true, body: { platform_type: 'CLOUD_API' } }])
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({
      isOnBizApp: false,
      platformType: 'CLOUD_API',
    })
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
    await expect(fetchPhoneBizAppState('PHONE', 'TOKEN')).resolves.toEqual({ isOnBizApp: false })
  })
})

describe('processCoexistenceWebhook', () => {
  it('acknowledges each coexistence field', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(processCoexistenceWebhook('history', { history: [] })).toEqual({ ok: true, field: 'history' })
    expect(processCoexistenceWebhook('smb_app_state_sync', {})).toEqual({ ok: true, field: 'smb_app_state_sync' })
    expect(processCoexistenceWebhook('smb_message_echoes', {})).toEqual({ ok: true, field: 'smb_message_echoes' })
  })
})

describe('syncSmbAppData', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  // Meta requires contacts to be synchronised before message history.
  it('requests contacts before history', async () => {
    const fn = mockFetchOnce([
      { ok: true, body: { success: true } },
      { ok: true, body: { success: true } },
    ])
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({ contacts: true, history: true })

    expect(fn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fn.mock.calls[0][1].body)).sync_type).toBe('smb_app_state_sync')
    expect(JSON.parse(String(fn.mock.calls[1][1].body)).sync_type).toBe('history')
  })

  // The sync may only be performed once per onboarding, so spending the history
  // attempt after a failed contact sync would waste the customer's only chance.
  it('does not attempt history when contacts fail', async () => {
    const fn = mockFetchOnce([{ ok: false, status: 500 }])
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({ contacts: false, history: false })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('reports partial success when history fails', async () => {
    mockFetchOnce([
      { ok: true, body: { success: true } },
      { ok: false, status: 500 },
    ])
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({ contacts: true, history: false })
  })

  it('never throws when the network fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch
    await expect(syncSmbAppData('PHONE', 'TOKEN')).resolves.toEqual({ contacts: false, history: false })
  })

  it('targets a Graph version that supports smb_app_data', async () => {
    const fn = mockFetchOnce([
      { ok: true, body: {} },
      { ok: true, body: {} },
    ])
    await syncSmbAppData('PHONE', 'TOKEN')
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('/smb_app_data')
    expect(url).not.toContain('/v19.0/')
  })
})
