import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { db } from '@/config/db'
import { AUTOMATIONS } from '@/lib/emailAutomations/registry'
import { dispatchAutomationEmail, type DispatchDeps } from '@/lib/emailAutomations/dispatch'
import { ownersCardTrialChargeSoon, ownersTrialEnding } from '@/lib/emailAutomations/recipients'
import { renderEmail } from '@/lib/email/render'
import type { Automation, Recipient } from '@/lib/emailAutomations/types'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'
import { seedAgency, seedUser, seedMethod, seedSubscription, seedCharge, cleanupBilling, hoursFromNow } from './helpers/billingFixtures'

beforeEach(() => vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', 'true'))
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupBilling()
})
afterAll(async () => {
  await db.destroy()
})

const started = AUTOMATIONS.find((a) => a.key === 'card_trial_started') as Automation
const reminder = AUTOMATIONS.find((a) => a.key === 'card_trial_charge_reminder') as Automation

const deps = (over: Partial<DispatchDeps> = {}): DispatchDeps => ({
  enabled: true,
  isSuppressed: vi.fn(async () => false),
  lifecycleCooldownActive: vi.fn(async () => false),
  claimSend: vi.fn(async () => true),
  markSent: vi.fn(async () => {}),
  releaseClaim: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ ok: true as const, id: 'mid' })),
  renderHtml: vi.fn(async () => '<p>h</p>'),
  renderText: vi.fn(async () => 't'),
  ...over,
})

async function cardTrialAgency(over: { trialEndsAt?: Date; sub?: Record<string, unknown>; method?: Record<string, unknown> } = {}) {
  const agencyId = await seedAgency({ trialStartedAt: hoursFromNow(-120), trialEndsAt: over.trialEndsAt ?? hoursFromNow(48) })
  const userId = await seedUser(agencyId)
  await seedMethod(agencyId, over.method ?? {})
  await seedSubscription(agencyId, over.sub ?? {})
  return { agencyId, userId }
}
const ids = (rows: Recipient[]) => rows.map((r) => r.agencyId)

describe('the ~2-day reminder audience', () => {
  it('includes a card trial charged in two days', async () => {
    const { agencyId } = await cardTrialAgency()
    expect(ids(await ownersCardTrialChargeSoon())).toContain(agencyId)
  })

  it.each([
    ['the customer cancelled', { sub: { cancelAtPeriodEnd: true } }],
    ['there is no active card', { method: { status: 'invalid' } }],
    ['the charge date already passed', { trialEndsAt: hoursFromNow(-2) }],
    ['the charge is still further away', { trialEndsAt: hoursFromNow(96) }],
    ['a Grow standing order exists', { sub: { growDirectDebitId: 'dd-1' } }],
  ])('excludes an agency when %s', async (_label, over) => {
    const { agencyId } = await cardTrialAgency(over)
    expect(ids(await ownersCardTrialChargeSoon())).not.toContain(agencyId)
  })

  it('excludes an agency whose first charge is already scheduled or settled', async () => {
    const { agencyId } = await cardTrialAgency()
    const pm = await db('billing_payment_methods').where({ agencyId }).first('id')
    await seedCharge(agencyId, Number(pm.id), { status: 'pending' })
    expect(ids(await ownersCardTrialChargeSoon())).not.toContain(agencyId)
  })

  it('is deduplicated per user by the send key', async () => {
    const { agencyId, userId } = await cardTrialAgency()
    const recipient = { userId, agencyId, email: 'o@example.com', firstName: 'דוד' }
    const claimSend = vi.fn(async () => true)
    expect(await dispatchAutomationEmail(reminder, recipient, new Date(), deps({ claimSend }))).toBe('sent')
    expect(claimSend).toHaveBeenCalledWith(expect.objectContaining({ automationKey: 'card_trial_charge_reminder', userId, periodKey: '' }))
    // A send already claimed for this (key, user) is not sent again.
    expect(await dispatchAutomationEmail(reminder, recipient, new Date(), deps({ claimSend: vi.fn(async () => false) }))).toBe('skipped')
  })

  it('announces no charge while token charges are disabled: the audience is empty', async () => {
    await cardTrialAgency()
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', '')
    expect(await ownersCardTrialChargeSoon()).toEqual([])
  })
})

describe('the no-card trial reminder', () => {
  it('never reaches a card-billed trial, and still reaches a click-to-start trial', async () => {
    const card = await cardTrialAgency({ trialEndsAt: hoursFromNow(30) })
    const noCardAgency = await seedAgency({ trialStartedAt: hoursFromNow(-120), trialEndsAt: hoursFromNow(30) })
    await seedUser(noCardAgency)
    const audience = ids(await ownersTrialEnding())
    expect(audience).not.toContain(card.agencyId)
    expect(audience).toContain(noCardAgency)
  })
})

describe('card-trial email copy', () => {
  it('states the exact persisted first-charge date, the price and the cancel path — and never "no credit card needed"', async () => {
    const trialEndsAt = hoursFromNow(48)
    const { agencyId, userId } = await cardTrialAgency({ trialEndsAt })
    const recipient = { userId, agencyId, email: 'o@example.com', firstName: 'דוד' }
    for (const automation of [started, reminder]) {
      const resolved = await automation.resolve!(recipient)
      const html = await renderEmail(resolved!.template)
      const text = html.replace(/<[^>]*>/g, ' ')
      expect(text).toContain(formatBillingDate(trialEndsAt))
      expect(text).toContain('89')
      expect(text).toContain('לבטל')
      expect(text).not.toContain('אין צורך בכרטיס אשראי')
      expect(resolved!.key).toBe(automation.key)
    }
  })

  it('sends nothing when the agency has no persisted trial end', async () => {
    const agencyId = await seedAgency()
    const userId = await seedUser(agencyId)
    expect(await started.resolve!({ userId, agencyId, email: 'o@example.com', firstName: null })).toBeNull()
  })
})
