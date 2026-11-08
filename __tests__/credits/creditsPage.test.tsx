/**
 * The page behind the WhatsApp link: reachable from a phone, admins only, and a
 * link for another account sells nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { renderToStaticMarkup } from 'react-dom/server'

const m = vi.hoisted(() => ({ user: { id: 1, agencyId: 7, role: 'ADMIN' } as Record<string, unknown> | null, redirect: vi.fn((p: string) => { throw new Error(`redirect:${p}`) }) }))
vi.mock('next/navigation', () => ({ redirect: m.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/db/auth', () => ({ getUser: async () => m.user }))
vi.mock('@/lib/i18n/server', () => ({ getUiLocaleState: async () => ({ locale: 'he' }) }))
vi.mock('@/actions/credits', () => ({ buyCreditPack: vi.fn() }))
vi.mock('@/lib/credits/balanceView', () => ({
  getCreditBalanceView: async () => ({ periodKey: '2026-11', metering: true, enforced: true, canPurchase: true, hasCard: true, freeLimit: 50, freeUsed: 50, purchasedAvailable: 0, exemptThisPeriod: 0, state: 'exhausted', packs: [{ kind: 'credits_200', credits: 200, priceIls: 49 }], purchases: [] }),
}))

import CreditsPage from '@/components/settings/payment/CreditsPageContent'
import { creditPurchaseUrl } from '@/lib/credits/purchaseLink'

const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CreditsPage({ searchParams: Promise.resolve(sp) }))
afterEach(() => {
  delete process.env.CREDITS_UI_AGENCY_IDS
  delete process.env.CREDITS_LINK_SECRET
  m.user = { id: 1, agencyId: 7, role: 'ADMIN' }
})

describe('/billing/credits', () => {
  it('sits outside the (app) layout that sends phones to /activate', () => {
    expect(readFileSync('app/(he)/(app)/layout.tsx', 'utf8')).toContain("redirect('/activate')")
    expect(new URL(creditPurchaseUrl(7)).pathname).toBe('/billing/credits')
  })
  it('an admin of an enabled agency sees the packs', async () => {
    process.env.CREDITS_UI_AGENCY_IDS = '7'
    expect(await html()).toContain('הוסף 200 ב-₪49')
  })
  it('a rep is refused', async () => {
    process.env.CREDITS_UI_AGENCY_IDS = '7'
    m.user = { id: 2, agencyId: 7, role: 'AGNT' }
    expect(await html()).not.toContain('הוסף 200')
  })
  it('an agency that is not enabled sees nothing to buy', async () => {
    expect(await html()).not.toContain('הוסף 200')
  })
  it('a link signed for another agency sells nothing', async () => {
    process.env.CREDITS_UI_AGENCY_IDS = '7'
    process.env.CREDITS_LINK_SECRET = 's'
    const out = await html({ credits: new URL(creditPurchaseUrl(8)).searchParams.get('credits')! })
    expect(out).toContain('הקישור הזה שייך לחשבון אחר')
    expect(out).not.toContain('הוסף 200')
  })
  it('no session goes to login', async () => {
    m.user = null
    await expect(html()).rejects.toThrow('redirect:/auth')
  })
})
