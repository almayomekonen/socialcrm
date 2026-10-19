import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/** /admin/whatsapp/assistant-demo: platform owners only; renders the labelled simulation. */
const session = vi.hoisted(() => ({ user: null as null | { id: number; email: string } }))
vi.mock('@/db/auth', () => ({ getUser: async () => session.user }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

import AssistantDemoPage from '@/app/admin/whatsapp/assistant-demo/page'

beforeEach(() => {
  process.env.PLATFORM_OWNER_EMAILS = 'owner@crm.test'
})
afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAILS
})

describe('assistant demo page', () => {
  it.each([null, { id: 2, email: 'someone@crm.test' }])('404 for %o', async (u) => {
    session.user = u
    await expect(AssistantDemoPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a platform owner sees the simulation, clearly labelled', async () => {
    session.user = { id: 1, email: 'owner@crm.test' }
    const html = renderToStaticMarkup(await AssistantDemoPage())
    expect(html).toContain('הדמיה')
    expect(html).toContain('שום הודעה לא נשלחת')
  })
})
