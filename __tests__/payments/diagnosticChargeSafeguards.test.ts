import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The runner charges a REAL card in production exactly once. It is temporary
 * and will be deleted, so what matters is that every safeguard is present on
 * the day it runs — and the failure mode being guarded against is structural
 * (a missing check, a claim written too late), which no behavioural test of the
 * charge path would catch.
 */

const src = readFileSync(`${process.cwd()}/app/api/internal/grow-diagnostic-charge/route.ts`, 'utf8')

/**
 * Comments stripped. The "must not appear" assertions below are about what the
 * route DOES; the file's prose says "no ApproveTransaction" and "writes nothing
 * to planReason" precisely because it does neither, and matching that sentence
 * would fail the file for documenting its own guarantee.
 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('one-shot production diagnostic charge', () => {
  it('is pinned to agency 103 / payment method 4 / ₪1', () => {
    expect(src).toContain('const AGENCY_ID = 103')
    expect(src).toContain('const PAYMENT_METHOD_ID = 4')
    expect(src).toContain('const SUM_ILS = 1')
  })

  it('claims durably BEFORE dispatch, under an advisory lock', () => {
    const claimAt = src.indexOf('pg_advisory_xact_lock')
    const insertAt = src.indexOf('INSERT INTO analytics_events')
    const chargeAt = src.indexOf('await chargeToken(')
    expect(claimAt).toBeGreaterThan(-1)
    expect(insertAt).toBeGreaterThan(claimAt)
    // The whole point: a marker written after the request proves nothing.
    expect(chargeAt).toBeGreaterThan(insertAt)
    expect(src).toContain("refuse('single_use'")
  })

  it('revalidates ownership, mode, liveness and provenance', () => {
    for (const guard of [
      "method.agencyId !== AGENCY_ID",
      "method.providerMode !== 'production'",
      "method.status !== 'active'",
      'bound?.confirmedAt',
      'bound.cardSuffix !== EXPECTED_SUFFIX',
      'String(bound.setupStatusCode) !== EXPECTED_SETUP_STATUS_CODE',
    ]) {
      expect(src).toContain(guard)
    }
  })

  it('refuses outside production and off the production host', () => {
    expect(src).toContain("runtime.env !== 'production' || runtime.mode !== 'production'")
    expect(src).toContain('GROW_PRODUCTION_BASE_URL')
  })

  it('sends one identifier, never ApproveTransaction, and never retries', () => {
    expect(code).not.toContain('transactionGroupIdentifier')
    expect(code).not.toContain('ApproveTransaction')
    // chargeToken is called exactly once in the file.
    expect(src.split('await chargeToken(').length - 1).toBe(1)
  })

  it('reconciles read-only on every outcome and grants nothing', () => {
    expect(src).toContain('lookupTokenTransactionsRaw')
    expect(src).toContain('interpretTokenLookup')
    // No path may hand out a paid month or a subscription.
    for (const forbidden of ["'payments'", "'subscriptions'", "'billing_charges'", 'planReason', 'trialEndsAt']) {
      expect(code).not.toContain(forbidden)
    }
  })

  it('never returns a secret or a card token', () => {
    expect(src).toContain('<redacted:')
    expect(code).not.toMatch(/return NextResponse\.json\([^)]*cardToken/)
  })
})
