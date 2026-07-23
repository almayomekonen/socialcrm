import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveWabaIdsFromToken, resolveWabaForPhone } from '@/lib/whatsapp/resolveWaba'

const APP_ID = 'app123'
const APP_SECRET = 'secret456'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as unknown as Response
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('resolveWabaIdsFromToken', () => {
  it('returns whatsapp_business_management target ids', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_1', 'WABA_2'] }] } }),
    )
    expect(await resolveWabaIdsFromToken('tok', APP_ID, APP_SECRET)).toEqual(['WABA_1', 'WABA_2'])
  })

  it('falls back to whatsapp_business_messaging when management is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['WABA_M'] }] } }),
    )
    expect(await resolveWabaIdsFromToken('tok', APP_ID, APP_SECRET)).toEqual(['WABA_M'])
  })

  it('returns [] when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, false))
    expect(await resolveWabaIdsFromToken('tok', APP_ID, APP_SECRET)).toEqual([])
  })

  it('returns [] on a thrown fetch (degrades, never throws)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect(await resolveWabaIdsFromToken('tok', APP_ID, APP_SECRET)).toEqual([])
  })

  it('returns [] when token or app credentials are missing', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await resolveWabaIdsFromToken('', APP_ID, APP_SECRET)).toEqual([])
    expect(await resolveWabaIdsFromToken('tok', undefined, APP_SECRET)).toEqual([])
    expect(await resolveWabaIdsFromToken('tok', APP_ID, undefined)).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns [] when granular_scopes is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: { granular_scopes: [] } }))
    expect(await resolveWabaIdsFromToken('tok', APP_ID, APP_SECRET)).toEqual([])
  })
})

describe('resolveWabaForPhone', () => {
  it('returns the sole WABA when the token manages exactly one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_ONLY'] }] } }),
    )
    expect(await resolveWabaForPhone('tok', 'PHONE_1', APP_ID, APP_SECRET)).toBe('WABA_ONLY')
  })

  it('disambiguates by phone_numbers when the token manages several WABAs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('debug_token')) {
        return jsonResponse({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_A', 'WABA_B'] }] } })
      }
      if (u.includes('/WABA_A/phone_numbers')) return jsonResponse({ data: [{ id: 'OTHER' }] })
      if (u.includes('/WABA_B/phone_numbers')) return jsonResponse({ data: [{ id: 'PHONE_TARGET' }] })
      return jsonResponse({}, false)
    })
    expect(await resolveWabaForPhone('tok', 'PHONE_TARGET', APP_ID, APP_SECRET)).toBe('WABA_B')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('returns null when no WABA can be resolved', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ data: { granular_scopes: [] } }))
    expect(await resolveWabaForPhone('tok', 'PHONE_1', APP_ID, APP_SECRET)).toBeNull()
  })

  it('returns null when several WABAs exist but none owns the phone', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('debug_token')) {
        return jsonResponse({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_A', 'WABA_B'] }] } })
      }
      return jsonResponse({ data: [{ id: 'SOMEONE_ELSE' }] })
    })
    expect(await resolveWabaForPhone('tok', 'PHONE_TARGET', APP_ID, APP_SECRET)).toBeNull()
  })
})
