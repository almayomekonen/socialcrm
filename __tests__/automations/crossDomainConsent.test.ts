import { afterEach, describe, expect, it } from 'vitest'
import { signLeadUnsubscribe, verifyLeadUnsubscribe } from '@/lib/automations/unsubscribeToken'
import { signUnsubscribe, verifyUnsubscribe } from '@/lib/emailAutomations/unsubscribeToken'

/**
 * §0 boundary, made executable at the consent layer. This is the ONE place
 * both domains are deliberately imported together — to prove they cannot
 * affect each other. (Engine source may never do this; the boundary guard
 * scans lib/db/actions/app, not tests.)
 *
 * The failure this prevents is concrete: a lead clicking "unsubscribe" must
 * never be able to silence a platform billing email, and a user opting out of
 * SocialCRM marketing must never silence a business's automations.
 */

const ID = 42

afterEach(() => {
  delete process.env.AUTOMATIONS_UNSUBSCRIBE_SECRET
  delete process.env.UNSUBSCRIBE_SECRET
})

describe('platform and customer consent tokens are disjoint', () => {
  it('a platform token never verifies as a lead token — for any agency', () => {
    const platformToken = signUnsubscribe(ID)
    for (const agencyId of [1, 7, ID, 999]) {
      expect(verifyLeadUnsubscribe(agencyId, ID, platformToken)).toBe(false)
    }
  })

  it('a lead token never verifies as a platform token', () => {
    expect(verifyUnsubscribe(ID, signLeadUnsubscribe(7, ID))).toBe(false)
    // ...including the tempting collision: agencyId and userId sharing a value.
    expect(verifyUnsubscribe(ID, signLeadUnsubscribe(ID, ID))).toBe(false)
  })

  it('the two schemes produce different material for identical ids', () => {
    expect(signLeadUnsubscribe(ID, ID)).not.toBe(signUnsubscribe(ID))
  })

  it('the domains read different secrets — rotating one cannot affect the other', () => {
    const platformBefore = signUnsubscribe(ID)
    process.env.AUTOMATIONS_UNSUBSCRIBE_SECRET = 'rotated-engine-secret'
    expect(signUnsubscribe(ID)).toBe(platformBefore) // platform unmoved
    expect(verifyLeadUnsubscribe(7, ID, signLeadUnsubscribe(7, ID))).toBe(true) // engine self-consistent
  })
})
