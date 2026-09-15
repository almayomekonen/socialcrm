import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { db } from '@/config/db'
import {
  createPendingPaymentMethod,
  attachSetupProcess,
  findPaymentMethodBySetupProcessId,
  activatePaymentMethod,
  decryptCardToken,
  decryptSetupProcessToken,
  markPaymentMethodStatus,
  hasConfirmedPaymentMethod,
  getActivePaymentMethod,
  getLatestConfirmedPaymentMethod,
  supersedePendingPaymentMethods,
  recordCallbackReceived,
} from '@/db/payments/paymentMethods'
import { seedAgency, cleanupBilling } from './helpers/billingFixtures'

afterEach(cleanupBilling)
afterAll(async () => {
  await db.destroy()
})

const holder = { fullName: 'John Smith', phone: '0501234567', email: 'o@example.com' }

async function pending(agencyId: number, processId: string, purpose: 'trial_start' | 'card_update' = 'trial_start') {
  const id = await createPendingPaymentMethod({
    agencyId,
    createdByUserId: null,
    providerMode: 'sandbox',
    purpose,
    reference: `ref-${processId}-${agencyId}`,
    holder,
    termsVersion: purpose === 'card_update' ? null : 'test',
  })
  await attachSetupProcess(id, `${processId}-${agencyId}`, `ptoken-${processId}`)
  const row = await findPaymentMethodBySetupProcessId(`${processId}-${agencyId}`)
  if (!row) throw new Error('fixture: pending method not found')
  return row
}

const card = (token: string) => ({
  cardToken: token,
  cardSuffix: '1234',
  cardBrand: 'Visa',
  cardExp: '1299',
  setupTransactionId: '301770',
  setupTransactionToken: 'tt',
  setupStatusCode: 'FIXTURE',
})

describe('payment methods', () => {
  it('stores the process token encrypted and finds the row by process id', async () => {
    const agencyId = await seedAgency()
    const m = await pending(agencyId, 'p1')
    expect(m.status).toBe('pending')
    expect(m.holder).toEqual(holder)
    expect(m.setupProcessTokenEnc).not.toBe('ptoken-p1')
    expect(decryptSetupProcessToken(m)).toBe('ptoken-p1')
  })

  it('records accepted terms for a trial start and none for a card replacement', async () => {
    const agencyId = await seedAgency()
    const trial = await pending(agencyId, 'p1t')
    const update = await pending(agencyId, 'p1u', 'card_update')
    const rows = await db('billing_payment_methods').whereIn('id', [trial.id, update.id]).orderBy('id')
    expect(rows[0].termsAcceptedAt).not.toBeNull()
    expect(rows[1]).toMatchObject({ termsVersion: null, termsAcceptedAt: null })
  })

  it('activates a pending method and encrypts the card token', async () => {
    const agencyId = await seedAgency()
    const m = await pending(agencyId, 'p2')
    expect(await hasConfirmedPaymentMethod(agencyId)).toBe(false)
    expect(await db.transaction((trx) => activatePaymentMethod(trx, m, card('ct-plain')))).toBe(true)
    const active = await getActivePaymentMethod(agencyId)
    expect(active?.id).toBe(m.id)
    expect(active?.cardTokenEnc).not.toBe('ct-plain')
    expect(decryptCardToken(active!)).toBe('ct-plain')
    expect(await hasConfirmedPaymentMethod(agencyId)).toBe(true)
  })

  it('is idempotent: a second activation of the same row returns false', async () => {
    const agencyId = await seedAgency()
    const m = await pending(agencyId, 'p3')
    await db.transaction((trx) => activatePaymentMethod(trx, m, card('a')))
    expect(await db.transaction((trx) => activatePaymentMethod(trx, m, card('b')))).toBe(false)
    expect(decryptCardToken((await getActivePaymentMethod(agencyId))!)).toBe('a')
  })

  it('replaces the previous active card when a new one is confirmed', async () => {
    const agencyId = await seedAgency()
    const first = await pending(agencyId, 'p4a')
    await db.transaction((trx) => activatePaymentMethod(trx, first, card('old')))
    const second = await pending(agencyId, 'p4b')
    await db.transaction((trx) => activatePaymentMethod(trx, second, card('new')))
    const statuses = (await db('billing_payment_methods').where({ agencyId }).orderBy('id').select('status')).map((r) => r.status)
    expect(statuses).toEqual(['replaced', 'active'])
    expect((await getLatestConfirmedPaymentMethod(agencyId))?.id).toBe(second.id)
  })

  it('a superseded setup can no longer be activated', async () => {
    const agencyId = await seedAgency()
    const older = await pending(agencyId, 'p5a')
    const newer = await pending(agencyId, 'p5b')
    expect(await supersedePendingPaymentMethods(db, agencyId, 'superseded_by_newer_setup', newer.id)).toBe(1)
    expect(await db.transaction((trx) => activatePaymentMethod(trx, older, card('late')))).toBe(false)
    expect(await db('billing_payment_methods').where({ id: older.id }).first()).toMatchObject({ status: 'invalid', invalidReason: 'superseded_by_newer_setup' })
    expect((await db('billing_payment_methods').where({ id: newer.id }).first()).status).toBe('pending')
  })

  it('records a received but unverified callback without changing status', async () => {
    const agencyId = await seedAgency()
    const m = await pending(agencyId, 'p6')
    await recordCallbackReceived(m.id, 'provider_evidence_missing')
    const row = await db('billing_payment_methods').where({ id: m.id }).first()
    expect(row).toMatchObject({ status: 'pending', lastVerificationError: 'provider_evidence_missing' })
    expect(row.lastCallbackAt).not.toBeNull()
  })

  it('records a terminal status with its reason', async () => {
    const agencyId = await seedAgency()
    const m = await pending(agencyId, 'p7')
    await markPaymentMethodStatus(db, m.id, 'needs_review', 'unexpected_status')
    expect(await db('billing_payment_methods').where({ id: m.id }).first()).toMatchObject({ status: 'needs_review', invalidReason: 'unexpected_status' })
  })
})
