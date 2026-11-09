/**
 * Usage credits — the pure core: balance arithmetic, cost weighting and the
 * configuration (absence blocks, every price and allowance configurable).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { aiCostToMillis, computeBalance, type LedgerTotal } from '@/lib/credits/balance'
import {
  PACK_KINDS,
  canPurchaseCredits,
  canSeeCreditBalance,
  creditPackDescription,
  isCreditEnforcedFor,
  isCreditsMeteringEnabled,
  isPackSellable,
  monthlyAllowance,
  packConfig,
  paidRequestHoldMillis,
  parseAgencyIds,
} from '@/lib/credits/config'

const t = (periodKey: string, entryType: string, sumMillis: number, count = 1): LedgerTotal => ({ periodKey, entryType, sumMillis, count })
const KEYS = Object.keys(process.env).filter((k) => k.startsWith('CREDITS_'))
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('CREDITS_') && !KEYS.includes(k)) delete process.env[k]
})

describe('the purchased balance', () => {
  it('purchases add, debits and refunds net out, and it does not expire', () => {
    const b = computeBalance([t('2026-10', 'purchase_grant', 200_000), t('2026-10', 'debit', -30_000), t('2026-11', 'debit', -10_000), t('2026-11', 'refund', 1000)], '2026-11')
    expect(b).toMatchObject({ purchasedTotalMillis: 200_000, availableMillis: 161_000, usedThisPeriodMillis: 9000 })
  })
  it('founder exempt entries cost nothing and are counted', () => {
    expect(computeBalance([t('2026-11', 'purchase_grant', 1000), t('2026-11', 'exempt_debit', 0, 7)], '2026-11')).toMatchObject({ availableMillis: 1000, exemptThisPeriod: 7 })
  })
})

describe('AI cost weighting', () => {
  it('debits exactly the actual cost, so an expensive model consumes more credits', () => {
    // An average assistant question (~$0.03) vs a lead summary (~$0.0012) at $0.03 per credit.
    expect(aiCostToMillis(0.03, 0.03)).toBe(1000)
    expect(aiCostToMillis(0.0012, 0.03)).toBe(40)
    expect(aiCostToMillis(0.0764, 0.03)).toBe(2547)
  })
  it('rounds up so a priced operation never debits zero; an unpriced one debits nothing', () => {
    expect(aiCostToMillis(0.0000001, 0.03)).toBe(1)
    expect(aiCostToMillis(null, 0.03)).toBe(0)
    expect(aiCostToMillis(0, 0.03)).toBe(0)
  })
})

describe('configuration', () => {
  it('everything is off when nothing is set', () => {
    expect(isCreditsMeteringEnabled()).toBe(false)
    expect(isCreditEnforcedFor(103, 'free')).toBe(false)
    expect(canPurchaseCredits(103)).toBe(false)
    expect(canSeeCreditBalance(103)).toBe(false)
    expect(isPackSellable(103, 'free')).toBe(false)
  })
  it('enforcement needs metering AND an explicit id; `all` is never accepted', () => {
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = '5'
    expect(isCreditEnforcedFor(5, 'free')).toBe(false)
    process.env.CREDITS_METERING = '1'
    expect(isCreditEnforcedFor(5, 'free')).toBe(true)
    expect(isCreditEnforcedFor(6, 'free')).toBe(false)
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = 'all'
    expect(isCreditEnforcedFor(5, 'free')).toBe(false)
    expect(parseAgencyIds(' 1, x, -2, 3.5, 4 ')).toEqual([1, 4])
  })
  it('a Pro agency is never enforced without the explicit policy switch', () => {
    process.env.CREDITS_METERING = '1'
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = '5'
    expect(isCreditEnforcedFor(5, 'pro')).toBe(false)
    process.env.CREDITS_ENFORCE_ON_PRO = '1'
    expect(isCreditEnforcedFor(5, 'pro')).toBe(true)
  })
  it('packs are sold only to a listed agency where requests are enforced', () => {
    process.env.CREDITS_PURCHASES_AGENCY_IDS = '5'
    expect(isPackSellable(5, 'free')).toBe(false)
    process.env.CREDITS_METERING = '1'
    process.env.CREDITS_ENFORCEMENT_AGENCY_IDS = '5'
    expect(isPackSellable(5, 'free')).toBe(true)
    expect(isPackSellable(5, 'pro')).toBe(false)
  })
  it('defaults match the decision and every value is configurable', () => {
    expect(monthlyAllowance()).toBe(50)
    expect(paidRequestHoldMillis()).toBe(3000)
    expect(PACK_KINDS).toEqual(['credits_200', 'credits_500'])
    expect(packConfig('credits_200')).toEqual({ kind: 'credits_200', credits: 200, priceIls: 49 })
    expect(packConfig('credits_500')).toEqual({ kind: 'credits_500', credits: 500, priceIls: 99 })
    process.env.CREDITS_MONTHLY_ALLOWANCE = '60'
    process.env.CREDITS_PACK_200_PRICE_ILS = '59'
    process.env.CREDITS_PACK_500_CREDITS = 'nonsense'
    expect(monthlyAllowance()).toBe(60)
    expect(packConfig('credits_200').priceIls).toBe(59)
    expect(packConfig('credits_500').credits).toBe(500)
  })
  it('the card statement line names the credits', () => {
    expect(creditPackDescription('credits_500', 500)).toBe('SocialCRM 500 קרדיטים')
  })
})
