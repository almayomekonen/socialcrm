/**
 * The page behind the WhatsApp link: reachable from a phone, admins only, a card
 * step when none is saved, and a success state with the way back to WhatsApp.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { renderToStaticMarkup } from 'react-dom/server'

const base = { periodKey: '2026-11', metering: true, enforced: true, canPurchase: true, hasCard: true, freeLimit: 50, freeUsed: 50, purchasedAvailable: 0, exemptThisPeriod: 0, state: 'exhausted', packs: [{ kind: 'credits_200', credits: 200, priceIls: 49 }], purchases: [], cardDeclined: false, latestPurchase: null }
const m = vi.hoisted(() => ({ user: { id: 1, agencyId: 7, role: 'ADMIN' } as Record<string, unknown> | null, view: {} as Record<string, unknown>, draft: null as string | null, eligible: true, redirect: vi.fn((p: string) => { throw new Error(`redirect:${p}`) }) }))
vi.mock('next/navigation', () => ({ redirect: m.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/db/auth', () => ({ getUser: async () => m.user }))
vi.mock('@/db/credits/agentRequests', () => ({ lastBlockedQuestion: async () => m.draft }))
vi.mock('@/lib/i18n/server', () => ({ getUiLocaleState: async () => ({ locale: 'he' }) }))
vi.mock('@/actions/credits', () => ({ buyCreditPack: vi.fn() }))
vi.mock('@/actions/paymentMethod', () => ({ startCardSetup: vi.fn() }))
vi.mock('@/actions/trial', () => ({ trackTrialStartClicked: vi.fn(), trackTrialStartFailed: vi.fn() }))
vi.mock('@/lib/credits/balanceView', () => ({ getCreditBalanceView: async () => m.view }))
vi.mock('@/lib/payments/cardTrial/recoverCardSetup', () => ({ refreshCardSetupState: async () => undefined }))
vi.mock('@/lib/payments/cardTrial/startCardSetup', () => ({ isCardSetupEligible: async () => m.eligible }))
vi.mock('@/lib/payments/cardTrial/availability', () => ({ describeCardBillingAvailability: () => ({ ok: true, reason: 'ok' }) }))

import CreditsPage from '@/components/settings/payment/CreditsPageContent'
import { creditPurchaseUrl } from '@/lib/credits/purchaseLink'

const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CreditsPage({ searchParams: Promise.resolve(sp) }))
const enabled = (view: Record<string, unknown> = {}) => {
  process.env.CREDITS_UI_AGENCY_IDS = '7'
  m.view = { ...base, ...view }
}
afterEach(() => {
  delete process.env.CREDITS_UI_AGENCY_IDS
  delete process.env.CREDITS_LINK_SECRET
  delete process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER
  m.view = { ...base }
  m.draft = null
  m.eligible = true
  m.user = { id: 1, agencyId: 7, role: 'ADMIN' }
})

describe('/billing/credits', () => {
  it('sits outside the (app) layout that sends phones to /activate', () => {
    expect(readFileSync('app/(he)/(app)/layout.tsx', 'utf8')).toContain("redirect('/activate')")
    expect(new URL(creditPurchaseUrl(7)).pathname).toBe('/billing/credits')
  })
  it('an admin of an enabled agency sees the packs', async () => {
    enabled()
    expect(await html()).toContain('הוסף 200 ב-₪49')
  })
  it('a rep is refused', async () => {
    enabled()
    m.user = { id: 2, agencyId: 7, role: 'AGNT' }
    expect(await html()).not.toContain('הוסף 200')
  })
  it('an agency that is not enabled sees nothing to buy', async () => {
    expect(await html()).not.toContain('הוסף 200')
  })
  it('a link signed for another agency sells nothing', async () => {
    enabled()
    process.env.CREDITS_LINK_SECRET = 's'
    const out = await html({ credits: new URL(creditPurchaseUrl(8)).searchParams.get('credits')! })
    expect(out).toContain('הקישור הזה שייך לחשבון אחר')
    expect(out).not.toContain('הוסף 200')
  })
  it('with no saved card it offers the existing card save, not the packs', async () => {
    enabled({ hasCard: false })
    const out = await html()
    expect(out).toContain('פרטי הכרטיס נשמרים אצל Grow')
    expect(out).toContain('<input')
    expect(out).not.toContain('הוסף 200')
  })
  it('a card the agency cannot add says so rather than offering a dead form', async () => {
    enabled({ hasCard: false })
    m.eligible = false
    expect(await html()).not.toContain('פרטי הכרטיס נשמרים אצל Grow')
  })
  it('a confirmed purchase shows success and returns to WhatsApp, with the refused request as a draft only', async () => {
    process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER = '972500000000'
    enabled({ latestPurchase: { state: 'success', credits: 200 }, purchasedAvailable: 200 })
    m.draft = 'מי ענה?'
    const out = await html()
    expect(out).toContain('הקרדיטים נוספו לחשבון')
    expect(out).toContain('200 קרדיטים נוספו')
    expect(out).toContain('חזרה לוואטסאפ')
    expect(out).toContain(`https://wa.me/972500000000?text=${encodeURIComponent('מי ענה?')}`)
  })
  it('an unconfirmed charge never claims success, and tells the customer not to buy again', async () => {
    enabled({ latestPurchase: { state: 'confirming' } })
    const out = await html()
    expect(out).toContain('אין צורך לרכוש שוב')
    expect(out).not.toContain('הקרדיטים נוספו לחשבון')
  })
  it('no session goes to login', async () => {
    m.user = null
    await expect(html()).rejects.toThrow('redirect:/auth')
  })
})
