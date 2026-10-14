import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * The platform-owner readiness page through the real component and the real
 * readiness logic (Meta mocked at fetch): the gate, GET-only checks, no send
 * path, and nothing secret in the HTML.
 */
const session = vi.hoisted(() => ({ user: null as null | { id: number; email: string } }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: vi.fn(async () => undefined) }))
const sender = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/whatsapp/platform/sendReminder', async (orig) => ({ ...(await orig<typeof import('@/lib/whatsapp/platform/sendReminder')>()), sendOwnerReminder: sender.send }))

import AdminWhatsappReadiness from '@/components/admin/whatsapp/AdminWhatsappReadiness'
import { connection } from 'next/server'

const TOKEN = 'EAAG_admin_page_token_not_real_0123456789'
const APP_SECRET = 'app-secret-admin-page-not-real'
const ENV = {
  PLATFORM_OWNER_EMAILS: 'owner@crm.test',
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '1000000000001',
  PLATFORM_WHATSAPP_WABA_ID: '2000000000002',
  PLATFORM_WHATSAPP_ACCESS_TOKEN: TOKEN,
  META_APP_ID: '962521689620138',
  META_APP_SECRET: APP_SECRET,
}
const META_ERROR_TEXT = 'Malformed access token EAAGsomething'

function mockMeta() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url)
    if (u.includes('debug_token')) {
      return new Response(JSON.stringify({ data: { is_valid: true, type: 'SYSTEM_USER', app_id: '962521689620138', expires_at: 0, scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'], granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['2000000000002'] }] } }), { status: 200 })
    }
    if (u.includes('message_templates')) return new Response(JSON.stringify({ error: { code: 190, message: META_ERROR_TEXT } }), { status: 401 })
    return new Response(JSON.stringify({ status: 'CONNECTED', quality_rating: 'GREEN', name_status: 'AVAILABLE_WITHOUT_REVIEW', display_phone_number: '+972 54-922-1572', health_status: { can_send_message: 'LIMITED' } }), { status: 200 })
  })
}
const render = async () => renderToStaticMarkup(await AdminWhatsappReadiness())

beforeEach(() => {
  Object.assign(process.env, ENV)
  session.user = null
  sender.send.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe('authorization', () => {
  it('no session: 404 and not a single Meta call', async () => {
    const meta = mockMeta()
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(meta).not.toHaveBeenCalled()
  })

  it('a signed-in user who is not a platform owner: 404 and not a single Meta call', async () => {
    session.user = { id: 7, email: 'rep@agency.test' }
    const meta = mockMeta()
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(meta).not.toHaveBeenCalled()
  })
})

describe('a platform owner', () => {
  it('sees all four checks, freshly (connection() awaited), from GET calls only, with no send path', async () => {
    session.user = { id: 1, email: 'owner@crm.test' }
    const meta = mockMeta()
    const html = await render()
    expect(vi.mocked(connection)).toHaveBeenCalled()
    for (const label of ['הגדרות בשרת', 'טוקן הגישה', 'מספר הטלפון', 'תבנית lead_followup_alert', 'לא מוכן לשליחה']) expect(html).toContain(label)
    expect(html).toContain('SYSTEM_USER')
    expect(html).toContain('LIMITED')
    expect(meta).toHaveBeenCalledTimes(3)
    for (const [url, init] of meta.mock.calls) {
      expect((init as RequestInit).method).toBe('GET')
      expect(String(url)).not.toMatch(/\/messages(\?|$)/)
    }
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('the HTML never contains the token, the app secret, the phone number or Meta error text', async () => {
    session.user = { id: 1, email: 'owner@crm.test' }
    mockMeta()
    const html = await render()
    for (const s of [TOKEN, APP_SECRET, `${ENV.META_APP_ID}|`, META_ERROR_TEXT, '972', 'display_phone_number', 'granular_scopes']) expect(html).not.toContain(s)
  })

  it('a network failure renders failed checks, never the error text', async () => {
    session.user = { id: 1, email: 'owner@crm.test' }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`boom ${TOKEN}`))
    const html = await render()
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain('boom')
  })
})
