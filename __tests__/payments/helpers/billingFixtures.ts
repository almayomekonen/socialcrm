import { db } from '@/config/db'
import { encryptSecret } from '@/lib/crypto/secrets'
import { Roles } from '@/types/roles'

/**
 * Shared fixtures for card-token billing DB tests. Local test data only.
 * Nothing here is Grow sandbox evidence.
 */

const TAG = '__test_card_billing_' + Date.now() + '_'
const created: number[] = []
const rand = () => Math.random().toString(36).slice(2, 10)
const idOf = (row: unknown) => Number(typeof row === 'object' && row !== null ? (row as { id: unknown }).id : row)

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000)

export async function seedAgency(over: Record<string, unknown> = {}): Promise<number> {
  const [row] = await db('agencies').insert({ name: TAG + rand(), plan: 'free', trialExempt: false, ...over }).returning('id')
  const id = idOf(row)
  created.push(id)
  return id
}

export async function seedUser(agencyId: number, role: Roles = Roles.ADMIN): Promise<number> {
  const [row] = await db('users')
    .insert({ agencyId, firstName: 'Owner', lastName: `Test ${rand()}`, email: `${TAG}${rand()}@example.com`, role })
    .returning('id')
  return idOf(row)
}

/** Defaults to an ACTIVE card whose plain token is 'card-token-plain'. */
export async function seedMethod(agencyId: number, over: Record<string, unknown> = {}): Promise<number> {
  const [row] = await db('billing_payment_methods')
    .insert({
      agencyId,
      providerMode: 'sandbox',
      purpose: 'trial_start',
      status: 'active',
      reference: TAG + rand(),
      holderFullName: 'John Smith',
      holderPhone: '0501234567',
      holderEmail: null,
      termsVersion: 'test',
      termsAcceptedAt: new Date(),
      cardToken: encryptSecret('card-token-plain'),
      cardSuffix: '1234',
      cardBrand: 'Visa',
      cardExp: '1299',
      confirmedAt: new Date(),
      ...over,
    })
    .returning('id')
  return idOf(row)
}

export async function seedSubscription(agencyId: number, over: Record<string, unknown> = {}): Promise<void> {
  await db('subscriptions').insert({ agencyId, cancelAtPeriodEnd: false, billingPeriod: 'monthly', ...over })
}

export async function seedCharge(agencyId: number, paymentMethodId: number, over: Record<string, unknown> = {}): Promise<number> {
  const [row] = await db('billing_charges')
    .insert({
      agencyId,
      paymentMethodId,
      kind: 'trial_conversion',
      periodKey: 'trial_end',
      groupIdentifier: 1,
      attempt: 1,
      amount: 89,
      billingPeriod: 'monthly',
      ...over,
    })
    .returning('id')
  return idOf(row)
}

export async function cleanupBilling(): Promise<void> {
  if (!created.length) return
  await db('billing_charges').whereIn('agencyId', created).delete()
  await db('billing_payment_methods').whereIn('agencyId', created).delete()
  await db('payments').whereIn('agencyId', created).delete()
  await db('subscriptions').whereIn('agencyId', created).delete()
  await db('analytics_events').whereIn('agencyId', created).delete()
  await db('users').whereIn('agencyId', created).delete()
  await db('agencies').whereIn('id', created).delete()
  created.length = 0
}
