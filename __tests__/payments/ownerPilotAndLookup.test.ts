import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildSingleExternalIdentifier, GrowLookupArgumentError, type TokenLookupIdentifier } from '@/lib/payments/grow/api'
import {
  cardTrialPilotAgencyIds,
  isCardRequiredTrialEnabledForAgency,
  areSubscriptionChargesEnabled,
} from '@/lib/payments/grow/config'
import { isTokenSaveVerificationEstablished, isTokenChargeDispatchEstablished, isTokenChargeReconciliationEstablished } from '@/lib/payments/grow/providerEvidence'

afterEach(() => vi.unstubAllEnvs())

/** Grow requires exactly one external identifier; the type cannot check input that arrives at runtime. */
describe('a lookup is refused before it is sent unless exactly one identifier is present', () => {
  const build = (v: unknown) => () => buildSingleExternalIdentifier(v as TokenLookupIdentifier)

  it('accepts exactly one, and maps it to the right field', () => {
    expect(buildSingleExternalIdentifier({ uniqueIdentifier: 7 })).toEqual({ transactionUniqueIdentifier: 7 })
    expect(buildSingleExternalIdentifier({ groupIdentifier: 9 })).toEqual({ transactionGroupIdentifier: 9 })
  })

  it('rejects BOTH', () => {
    expect(build({ uniqueIdentifier: 7, groupIdentifier: 9 })).toThrow(GrowLookupArgumentError)
    expect(build({ uniqueIdentifier: 7, groupIdentifier: 9 })).toThrow(/multiple_identifiers/)
  })

  it('rejects NEITHER', () => {
    expect(build({})).toThrow(/no_identifier/)
    expect(build(undefined)).toThrow(/no_identifier/)
    // An explicit undefined/null is absence, not a value.
    expect(build({ uniqueIdentifier: undefined })).toThrow(/no_identifier/)
    expect(build({ groupIdentifier: null })).toThrow(/no_identifier/)
  })

  it('rejects a value that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity, {}, 'abc', '']) {
      expect(build({ uniqueIdentifier: bad }), String(bad)).toThrow(/invalid_identifier/)
    }
  })

  it('accepts a numeric STRING, because a bigint column arrives as one', () => {
    expect(buildSingleExternalIdentifier({ uniqueIdentifier: '7' } as unknown as TokenLookupIdentifier)).toEqual({
      transactionUniqueIdentifier: 7,
    })
  })

  it('rejects an identifier JavaScript cannot represent exactly', () => {
    // Silently becomes 9007199254740992 — a different transaction.
    expect(build({ uniqueIdentifier: '9007199254740993' })).toThrow(/invalid_identifier/)
  })
})

describe('the owner pilot widens who is asked for a card, and nothing else', () => {
  function pilot(ids: string) {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', '') // global card wall OFF
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', ids)
  }

  it('asks the listed agency for a card while everyone else is untouched', () => {
    pilot('42')
    expect(isCardRequiredTrialEnabledForAgency(42)).toBe(true)
    expect(isCardRequiredTrialEnabledForAgency(43)).toBe(false)
  })

  it('never opens a provider-evidence gate', () => {
    pilot('42')
    expect(isTokenSaveVerificationEstablished('production')).toBe(false)
    expect(isTokenChargeDispatchEstablished('production')).toBe(false)
    expect(isTokenChargeReconciliationEstablished('production')).toBe(false)
  })

  it('never enables charging — a card save is not a licence to bill', () => {
    pilot('42')
    vi.stubEnv('SUBSCRIPTION_CHARGES_ENABLED', '')
    expect(areSubscriptionChargesEnabled()).toBe(false)
  })

  it('has no wildcard and denies by default', () => {
    pilot('')
    expect(cardTrialPilotAgencyIds().size).toBe(0)
    expect(isCardRequiredTrialEnabledForAgency(42)).toBe(false)
    for (const junk of ['*', 'all', '0', '-1', 'abc', ' , , ']) {
      pilot(junk)
      expect(cardTrialPilotAgencyIds().size, junk).toBe(0)
      expect(isCardRequiredTrialEnabledForAgency(42), junk).toBe(false)
    }
  })

  it('still applies to everyone once the global flag is on', () => {
    vi.stubEnv('CARD_REQUIRED_TRIAL_ENABLED', 'true')
    vi.stubEnv('CARD_TRIAL_PILOT_AGENCY_IDS', '')
    expect(isCardRequiredTrialEnabledForAgency(999)).toBe(true)
  })
})
