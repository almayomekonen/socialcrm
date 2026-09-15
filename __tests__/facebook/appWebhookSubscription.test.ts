/**
 * The app-level half of Messenger delivery (Meta dashboard → Webhooks → Page).
 * Incident 2026-09-14 cause (a): the app's Page subscription had leadgen,feed only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { missingAppMessengerFields } from '@/lib/facebook/appWebhookSubscription'

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const SUBSCRIPTIONS = (pageFields: string[]) => ({
  data: [
    { object: 'whatsapp_business_account', fields: [{ name: 'messages', version: 'v25.0' }] },
    { object: 'page', callback_url: 'https://example.test/api/webhooks/facebook', fields: pageFields.map((name) => ({ name })) },
  ],
})

afterEach(() => vi.unstubAllEnvs())

describe('missingAppMessengerFields', () => {
  it('names the Messenger fields the app Page subscription lacks — the incident state', async () => {
    vi.stubEnv('META_APP_ID', '962521689620138')
    vi.stubEnv('META_APP_SECRET', 'shh')
    const fetchImpl = vi.fn(async () => res(200, SUBSCRIPTIONS(['leadgen', 'feed'])))
    expect(await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)).toEqual(['messages', 'message_echoes'])
  })

  it("does not borrow WhatsApp's `messages` field for the Page object", async () => {
    vi.stubEnv('META_APP_ID', '962521689620138')
    vi.stubEnv('META_APP_SECRET', 'shh')
    const fetchImpl = vi.fn(async () => res(200, SUBSCRIPTIONS(['leadgen', 'feed', 'message_echoes'])))
    expect(await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)).toEqual(['messages'])
  })

  it('nothing missing once the dashboard is configured', async () => {
    vi.stubEnv('META_APP_ID', '962521689620138')
    vi.stubEnv('META_APP_SECRET', 'shh')
    const fetchImpl = vi.fn(async () => res(200, SUBSCRIPTIONS(['leadgen', 'feed', 'messages', 'message_echoes'])))
    expect(await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)).toEqual([])
  })

  it('keeps the app secret out of the URL', async () => {
    vi.stubEnv('META_APP_ID', '962521689620138')
    vi.stubEnv('META_APP_SECRET', 'shh')
    const fetchImpl = vi.fn(async () => res(200, SUBSCRIPTIONS([])))
    await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('shh')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer 962521689620138|shh')
  })

  it('null — no claim — when credentials are absent or Meta cannot be read', async () => {
    vi.stubEnv('META_APP_ID', '')
    vi.stubEnv('META_APP_SECRET', '')
    const fetchImpl = vi.fn(async () => res(500, { error: { code: 2 } }))
    expect(await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    vi.stubEnv('META_APP_ID', '962521689620138')
    vi.stubEnv('META_APP_SECRET', 'shh')
    expect(await missingAppMessengerFields(fetchImpl as unknown as typeof fetch)).toBeNull()
    const throwing = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await missingAppMessengerFields(throwing as unknown as typeof fetch)).toBeNull()
  })
})
