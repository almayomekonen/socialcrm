import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import { reconciliationSubject, growChargeReconciler } from '@/lib/payments/charges/reconcileUnknown'
import type { ChargeRow } from '@/db/payments/charges'
import { encryptSecret } from '@/lib/crypto/secrets'
import { seedAgency, seedMethod, seedSubscription, seedCharge, cleanupBilling } from './helpers/billingFixtures'

/**
 * An unknown outcome is asked about using the card THAT ATTEMPT used. A customer
 * who replaces a card while an outcome is unresolved would otherwise have the
 * wrong token queried, and Grow's answer would be about a different card.
 */
afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

const chargeRow = (id: number) => db('billing_charges').where({ id }).first() as Promise<ChargeRow>

describe('reconciliationSubject', () => {
  it('uses the attempt’s own card, not the one the agency has on file now', async () => {
    const agencyId = await seedAgency()
    const original = await seedMethod(agencyId, { cardToken: encryptSecret('token-of-the-attempt') })
    await seedSubscription(agencyId)
    const chargeId = await seedCharge(agencyId, original, { status: 'unknown', dispatchedAt: new Date() })

    // The customer replaces the card while the outcome is still unknown.
    await db('billing_payment_methods').where({ id: original }).update({ status: 'replaced' })
    await seedMethod(agencyId, { cardToken: encryptSecret('token-of-the-replacement') })

    const subject = await reconciliationSubject(await chargeRow(chargeId))
    expect(subject).toEqual({ cardToken: 'token-of-the-attempt', uniqueIdentifier: chargeId })
  })

  it('refuses a payment method belonging to another agency', async () => {
    const mine = await seedAgency()
    const theirs = await seedAgency()
    const foreign = await seedMethod(theirs)
    await seedSubscription(mine)
    const pm = await seedMethod(mine)
    const chargeId = await seedCharge(mine, pm, { status: 'unknown', dispatchedAt: new Date() })
    await db('billing_charges').where({ id: chargeId }).update({ paymentMethodId: foreign })

    expect(await reconciliationSubject(await chargeRow(chargeId))).toEqual({ error: 'attempt_payment_method_agency_mismatch' })
  })

  it('refuses when the attempt’s card is gone', async () => {
    const agencyId = await seedAgency()
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId)
    const chargeId = await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date() })
    const row = await chargeRow(chargeId)
    expect(await reconciliationSubject({ ...row, paymentMethodId: pm + 99_000 })).toEqual({ error: 'attempt_payment_method_missing' })
  })

  it('the live reconciler still returns no verdict, and says why', async () => {
    const agencyId = await seedAgency()
    const pm = await seedMethod(agencyId)
    await seedSubscription(agencyId)
    const chargeId = await seedCharge(agencyId, pm, { status: 'unknown', dispatchedAt: new Date() })
    // Gate closed: a subject resolves, but no verdict is invented from an
    // undocumented lookup response.
    expect(await growChargeReconciler(await chargeRow(chargeId))).toEqual({
      kind: 'undetermined',
      reason: 'provider_evidence_missing',
    })
  })
})
