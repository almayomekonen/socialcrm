import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyFacebookAccessToken } from '@/lib/auth/verifyFacebookAccessToken'

const AUTH_APP_ID = '1576374570608325'
const AUTH_APP_SECRET = 'test-auth-app-secret'
const BUSINESS_APP_ID = '962521689620138'
const USER_TOKEN = 'EAAG-user-token'
const USER_ID = '27802810426038835'

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

describe('verifyFacebookAccessToken', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_FACEBOOK_APP_ID', AUTH_APP_ID)
    vi.stubEnv('AUTH_FACEBOOK_APP_SECRET', AUTH_APP_SECRET)
    vi.stubEnv('META_APP_ID', BUSINESS_APP_ID)
    vi.stubEnv('META_APP_SECRET', 'business-secret-must-not-be-used')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns Meta identity when debug_token is a valid USER token for the auth app and /me has email', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/debug_token')) {
        expect(url).toContain(encodeURIComponent(`${AUTH_APP_ID}|${AUTH_APP_SECRET}`))
        expect(url).not.toContain('business-secret-must-not-be-used')
        return jsonResponse({
          data: { is_valid: true, app_id: AUTH_APP_ID, type: 'USER', user_id: USER_ID },
        })
      }
      if (url.includes('/me?')) {
        expect(url).toContain('fields=id,name,email,picture')
        return jsonResponse({
          id: USER_ID,
          name: 'Dana Cohen',
          email: 'dana@example.com',
          picture: { data: { url: 'https://example.com/p.jpg' } },
        })
      }
      return jsonResponse({}, false)
    })

    const result = await verifyFacebookAccessToken(USER_TOKEN)
    expect(result).toEqual({
      ok: true,
      identity: {
        email: 'dana@example.com',
        name: 'Dana Cohen',
        picture: 'https://example.com/p.jpg',
        sub: USER_ID,
      },
    })
  })

  it('returns no_email when Facebook omits email — does not invent identity', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/debug_token')) {
        return jsonResponse({
          data: { is_valid: true, app_id: AUTH_APP_ID, type: 'USER', user_id: USER_ID },
        })
      }
      return jsonResponse({ id: USER_ID, name: 'Dana Cohen' })
    })

    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'no_email' })
  })

  it('rejects a token issued for the business Meta app', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: { is_valid: true, app_id: BUSINESS_APP_ID, type: 'USER', user_id: USER_ID } }),
    )
    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects an invalid or expired token', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: { is_valid: false, app_id: AUTH_APP_ID, type: 'USER', user_id: USER_ID } }),
    )
    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects a Page token so Page-connect credentials cannot log a user in', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: { is_valid: true, app_id: AUTH_APP_ID, type: 'PAGE', user_id: 'page-1' } }),
    )
    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects a token issued for a different app', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ data: { is_valid: true, app_id: '999', type: 'USER', user_id: USER_ID } }),
    )
    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
  })

  it('rejects empty or non-string tokens without calling Graph', async () => {
    await expect(verifyFacebookAccessToken('')).resolves.toEqual({ ok: false, reason: 'invalid_token' })
    await expect(verifyFacebookAccessToken(undefined)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects when /me id does not match debug_token user_id', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/debug_token')) {
        return jsonResponse({
          data: { is_valid: true, app_id: AUTH_APP_ID, type: 'USER', user_id: USER_ID },
        })
      }
      return jsonResponse({ id: 'someone-else', email: 'dana@example.com' })
    })
    await expect(verifyFacebookAccessToken(USER_TOKEN)).resolves.toEqual({ ok: false, reason: 'invalid_token' })
  })
})
