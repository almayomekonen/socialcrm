import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { classifyTokenChargeError, DUPLICATE_IDENTIFIER_ERROR_ID } from '@/lib/payments/grow/tokenErrors'
import {
  GROW_SUPPORT_CONFIRMATIONS,
  isTokenChargeDispatchEstablished,
  isTokenChargeReconciliationEstablished,
} from '@/lib/payments/grow/providerEvidence'

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
  /**
   * This used to assert that api.ts DOCUMENTED the group identifier as
   * grouping-only. Grow has since instructed that a token charge carry exactly
   * one identifier, so the field is not sent at all — a stronger guarantee than
   * a comment, and the assertion is raised to match rather than relaxed.
   */
  it('is never sent on a token charge: the request builder names only the unique one', () => {
    const api = read('lib/payments/grow/api.ts')
    const start = api.indexOf("postGrowForm('createTransactionWithToken'")
    expect(start).toBeGreaterThan(-1)
    // The request object literal only — up to the closing `})` of the call.
    const call = api.slice(start, api.indexOf('})', start))
    expect(call).toContain('transactionUniqueIdentifier: input.uniqueIdentifier')
    // As an object KEY, not as prose: the comment above the field names it too.
    expect(call).not.toMatch(/^\s*transactionGroupIdentifier\s*:/m)
  })

  it('is still ours for grouping the attempts of a period, in the database', () => {
    // Removing it from the wire must not remove it from the charge row: that is
    // what keeps a retry attached to the period it belongs to.
    expect(read('db/payments/charges.ts')).toContain('groupIdentifier')
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
  it('the type admits one and only one, and runtime checks it too', () => {
    const api = read('lib/payments/grow/api.ts')
    expect(api).toContain("export type TokenLookupIdentifier = { uniqueIdentifier: number } | { groupIdentifier: number }")
    // The request is assembled by a validator that throws before anything is
    // sent — the type alone cannot police input that arrives at runtime.
    // (both/neither/non-integer rejection is covered in ownerPilotAndLookup.test.ts)
    expect(api).toContain('buildSingleExternalIdentifier(input.identifier)')
    expect(api).toContain('GrowLookupArgumentError')
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

describe('Grow’s written confirmations (2026-09-17) are recorded, not remembered', () => {
  it('records the environment, the ApproveTransaction answer, and the hold', async () => {
    const { GROW_SUPPORT_CONFIRMATIONS } = await import('@/lib/payments/grow/providerEvidence')
    expect(GROW_SUPPORT_CONFIRMATIONS).toMatchObject({
      environment: 'test',
      approveTransactionRequired: false,
      tokenSaveIsAuthorizationHoldOnly: true,
      holdReleasedWithinDays: 10,
    })
  })

  it('discloses the hold to the customer, and never as a subscription charge', async () => {
    const { TOKEN_HOLD_NOTICE, cardTrialDisclosureLines } = await import('@/lib/payments/cardTrial/terms')
    expect(TOKEN_HOLD_NOTICE).toContain('אינה גבייה')
    // Grow's stated policy, attributed and bounded — never a promised date.
    expect(TOKEN_HOLD_NOTICE).toContain('לפי ספק הסליקה Grow')
    expect(TOKEN_HOLD_NOTICE).toContain('עד 10 ימים')
    expect(cardTrialDisclosureLines()).toContain(TOKEN_HOLD_NOTICE)
  })

  it('what opened the production save gate was an observation, not this answer', async () => {
    const { isTokenSaveVerificationEstablished, acceptedTokenSaveStatusCodes, GROW_PROVIDER_EVIDENCE } = await import(
      '@/lib/payments/grow/providerEvidence'
    )
    /*
     * WAS: "production evidence stays closed". It is open now — opened on
     * 2026-09-25 by a real production card save whose statusCode we read back
     * with our own credentials. The rule the old assertion protected is
     * unchanged and still tested here: the gate may only ever be opened by an
     * EXECUTED observation, never by Grow saying something in writing.
     */
    expect(isTokenSaveVerificationEstablished('production')).toBe(true)
    expect(acceptedTokenSaveStatusCodes('production')).toEqual(['11'])

    // The reference names an observation of the production account, not a
    // sandbox run and not a support reply.
    const ref = GROW_PROVIDER_EVIDENCE.tokenSaveVerification.production.evidenceRef ?? ''
    expect(ref).toContain('card_save_observed')
    expect(ref).not.toContain('charge_probe')
  })
})

describe("Grow's 2026-09-17 replies, as recorded", () => {
  it('a token charge carries exactly one identifier, and it is the unique one', () => {
    expect(GROW_SUPPORT_CONFIRMATIONS.tokenChargeIdentifierCount).toBe(1)
    expect(GROW_SUPPORT_CONFIRMATIONS.approveTransactionRequired).toBe(false)
  })

  it('a written clarification is not approval: the site review and credentials stay pending', () => {
    expect(GROW_SUPPORT_CONFIRMATIONS.websiteReview).toBe('pending')
    expect(GROW_SUPPORT_CONFIRMATIONS.productionCredentials).toBe('pending')
  })

  it('and it is not execution evidence either — production gates remain shut', () => {
    // The whole point: Grow saying "ApproveTransaction is not required" does not
    // open a gate. Only an observed production charge does.
    expect(isTokenChargeDispatchEstablished('production')).toBe(false)
    expect(isTokenChargeReconciliationEstablished('production')).toBe(false)
  })
})
