import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { classifyTokenChargeError, DUPLICATE_IDENTIFIER_ERROR_ID } from '@/lib/payments/grow/tokenErrors'

/**
 * Grow support's integration guidance, pinned so it cannot be undone by a later
 * edit that looks reasonable in isolation.
 */

const read = (p: string) => readFileSync(p, 'utf8')

describe('duplicate unique identifier (1010) is reconciled, never recharged', () => {
  it('is classified on its own, not as a decline and not as retryable', () => {
    expect(classifyTokenChargeError(DUPLICATE_IDENTIFIER_ERROR_ID, 'כבר קיים')).toBe('duplicate_identifier')
    // Even if the message happens to match a documented decline row, the id wins.
    expect(classifyTokenChargeError(DUPLICATE_IDENTIFIER_ERROR_ID, 'כרטיס פג תוקף')).toBe('duplicate_identifier')
  })

  it('leaves the ordinary table untouched', () => {
    expect(classifyTokenChargeError(451, 'anything')).toBe('final')
    expect(classifyTokenChargeError(103, 'חברת האשראי לא אשרה את העסקה')).toBe('retryable')
    expect(classifyTokenChargeError(9999, 'undocumented')).toBe('unknown')
  })

  it('the charge engine sends it to reconciliation and schedules no new attempt', () => {
    const src = read('lib/payments/charges/executeCharge.ts')
    const branch = src.slice(src.indexOf("errorClass === 'duplicate_identifier'"), src.indexOf("errorClass === 'unknown'"))
    expect(branch).toContain("markChargeUnknown(charge.id, 'duplicate_identifier'")
    // No retry is scheduled on this path — that is what would double-charge.
    expect(branch).not.toContain('insertNextAttempt')
    expect(branch).not.toContain('nextRetryAt')
    expect(branch).not.toContain('markChargeFailed')
  })
})

describe('transactionGroupIdentifier is not a duplicate-charge guard', () => {
  it('is documented as grouping only, with our own constraints named as the guard', () => {
    const api = read('lib/payments/grow/api.ts')
    expect(api).toContain('not a duplicate-charge guard')
    expect(api).toContain('transactionUniqueIdentifier per attempt')
  })

  it('nothing decides an outcome from the group identifier', () => {
    for (const f of ['lib/payments/charges/executeCharge.ts', 'lib/payments/charges/reconcileUnknown.ts', 'lib/payments/charges/applySuccessfulCharge.ts']) {
      const src = read(f)
      // It may be passed through; it may never be compared or branched on.
      expect(src).not.toMatch(/groupIdentifier\s*===/)
      expect(src).not.toMatch(/if\s*\(\s*[a-zA-Z.]*groupIdentifier/)
    }
  })
})

describe('a lookup carries exactly one external identifier', () => {
  it('the type admits one and only one', () => {
    const api = read('lib/payments/grow/api.ts')
    expect(api).toContain("export type TokenLookupIdentifier = { uniqueIdentifier: number } | { groupIdentifier: number }")
    // Built by choosing a branch, so both can never be spread into one request.
    expect(api).toContain("'uniqueIdentifier' in input.identifier")
  })
})

/** Comments may (and do) name it in order to forbid it; code may never call it. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('ApproveTransaction is never sent for token-only flows', () => {
  it('is never called, however it is spelled', () => {
    const files = [
      'lib/payments/grow/api.ts',
      'lib/payments/grow/http.ts',
      'lib/payments/cardTrial/startCardSetup.ts',
      'lib/payments/cardTrial/confirmCardSetup.ts',
      'lib/payments/cardTrial/verifyTokenSave.ts',
      'lib/payments/charges/executeCharge.ts',
    ]
    for (const f of files) {
      expect(withoutComments(read(f)).toLowerCase(), f).not.toContain('approvetransaction')
    }
  })

  it('the prohibition is still written down where the endpoints live', () => {
    expect(read('lib/payments/grow/api.ts')).toContain('Never send ApproveTransaction')
  })
})

describe('card storage is consented to in our own interface', () => {
  it('is a separate checkbox from the subscription agreement', () => {
    const form = read('components/trial/CardTrialSetupForm.tsx')
    expect(form).toContain('CARD_TRIAL_CONSENT_LABEL')
    expect(form).toContain('CARD_STORAGE_CONSENT_LABEL')
    expect(form).toContain('acceptedCardStorage: storageAccepted')
  })

  it('is required server-side for every purpose, and recorded', () => {
    const action = read('lib/payments/cardTrial/startCardSetup.ts')
    expect(action).toContain("if (input.acceptedCardStorage !== true) return { error: 'card_storage_consent_required' }")
    expect(action).toContain('cardStorageConsentVersion: CARD_STORAGE_CONSENT_VERSION')
    const db = read('db/payments/paymentMethods.ts')
    expect(db).toContain('cardStorageConsentAt: new Date()')
  })
})
