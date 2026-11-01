import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE BUG THIS PINS.
 *
 * A card save whose callback arrived while the evidence gate was shut stays at
 * status 'pending'. Grow will not resend a callback it already got a 200 for,
 * so the row is only ever finished by something asking again.
 *
 * For a long time the only thing that asked was the Grow return page's poll.
 * Navigate away from it and the attempt was stranded: the billing centre — the
 * page the customer actually returns to — read the stale row and rendered the
 * add-a-card form, which reads as "your save did not happen" and invites a
 * second entry that supersedes the first. Agency 103 did exactly that twice.
 *
 * Source-level assertions on purpose: the failure was a MISSING CALL, and no
 * amount of testing the recovery function itself would have caught a page that
 * never invoked it.
 */

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('the billing page finishes a recoverable save', () => {
  it('invokes recovery before it decides what to render', () => {
    const src = read('app/(he)/(app)/settings/(user_settings)/update_payment/page.tsx')
    expect(src).toContain("import { refreshCardSetupState } from '@/lib/payments/cardTrial/recoverCardSetup'")
    expect(src).toContain('await refreshCardSetupState(user.agencyId)')

    // Order matters: recovering after the view is read would render the stale
    // row and only take effect on the NEXT visit.
    expect(src.indexOf('await refreshCardSetupState(user.agencyId)')).toBeLessThan(
      src.indexOf('const cardView = await getCardTrialView(user.agencyId)'),
    )
  })

  it('shares one implementation with the return page’s poll', () => {
    const action = read('actions/paymentMethod.ts')
    expect(action).toContain('return await refreshCardSetupState(user.agencyId)')
    // The action must not keep a second copy of the recover-then-reread dance.
    expect(action).not.toContain('await recoverPendingCardSetup(')
  })

  it('recovery stays gated on a received callback — it never forges one', () => {
    const src = read('lib/payments/cardTrial/recoverCardSetup.ts')
    expect(src).toContain("if (current.state !== 'verifying' || !current.callbackReceived) return current")
    // A failed recovery returns the true state instead of throwing at a caller
    // that was only rendering a page.
    expect(src).toContain('return current')
  })
})
