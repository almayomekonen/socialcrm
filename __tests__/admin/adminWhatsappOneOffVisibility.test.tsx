import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/** /admin/whatsapp shows the one-off test send only to a platform owner, and only while it is configured. */
const session = vi.hoisted(() => ({ user: null as null | { id: number; email: string } }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') }, useRouter: () => ({ refresh: () => undefined }) }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: vi.fn(async () => undefined) }))
vi.mock('@/lib/whatsapp/platform/readiness', () => ({ checkOwnerReminderReadiness: async () => ({ ready: false, checks: [] }) }))
const action = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/actions/admin/ownerWaOneOff', () => ({ sendOwnerWaOneOffTestAction: (...a: unknown[]) => action.run(...a) }))

import AdminWhatsappReadiness from '@/components/admin/whatsapp/AdminWhatsappReadiness'

const render = async () => renderToStaticMarkup(await AdminWhatsappReadiness())
const HEADING = 'שליחת תזכורת בדיקה אחת'

beforeEach(() => {
  process.env.PLATFORM_OWNER_EMAILS = 'owner@crm.test'
  session.user = { id: 332, email: 'owner@crm.test' }
})
afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAILS
  delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
})

describe('one-off test send on /admin/whatsapp', () => {
  it.each([undefined, '', '0', 'all'])('hidden while OWNER_WA_ONE_OFF_RECIPIENT_ID is %s', async (v) => {
    if (v === undefined) delete process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID
    else process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = v
    expect(await render()).not.toContain(HEADING)
  })

  it('shown to a platform owner when configured, without exposing the recipient', async () => {
    process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = '1'
    const html = await render()
    expect(html).toContain(HEADING)
    expect(html).not.toMatch(/972\d{6,}/)
    expect(action.run).not.toHaveBeenCalled()
  })

  it('a non-owner still gets 404, configured or not', async () => {
    process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = '1'
    session.user = { id: 400, email: 'someone@crm.test' }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
