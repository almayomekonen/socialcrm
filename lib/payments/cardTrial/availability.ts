import { assertGrowRuntime, getGrowApiConfig, publicAppOrigin } from '@/lib/payments/grow/config'
import { isGrowLocalMockEnabled } from '@/lib/payments/grow/localMock'
import { isCardSetupEligible } from './startCardSetup'
import type { PaymentMethodPurpose } from '@/db/payments/paymentMethods'

/**
 * Can a card setup actually be completed right now?
 *
 * Payment Links are gone, so this is the only way to pay. That raises the cost
 * of getting it wrong: a CTA that opens a setup which cannot finish is a
 * dead end on the one screen where the customer is trying to give us money.
 * Every surface that offers to start, replace or reactivate a card asks this
 * first and shows a temporary-unavailability state instead when it is false.
 *
 * It answers the provider question only — is the runtime allowed to call Grow,
 * and is Grow configured. Whether THIS agency may start THIS purpose is a
 * separate question, decided per request by startCardSetupForUser.
 *
 * Deliberately not consulted: the provider-evidence gates. Those govern
 * charging and token-save verification, not whether the hosted page can open,
 * and a callback arriving while they are closed is recorded honestly as
 * awaiting evidence rather than claimed as success.
 */
export function isCardBillingAvailable(): boolean {
  // The local demo replaces the provider wholesale; it fails closed anywhere
  // that is not a developer machine.
  if (isGrowLocalMockEnabled()) return true
  try {
    assertGrowRuntime()
    getGrowApiConfig() // throws when GROW_USER_ID / GROW_PAGE_CODE_TOKEN are missing
    publicAppOrigin() // throws when APP_HOST is absent or localhost — Grow cannot call back
    return true
  } catch {
    return false
  }
}

/**
 * Which card setup, if any, this agency may start from the billing screen.
 *
 * Asks the same question the server action asks, so the screen never offers a
 * setup the request would refuse. `null` means no purpose applies — today that
 * includes an agency whose trial has expired without ever having saved a card,
 * because `reactivate` needs a previous card to replace. Those agencies used to
 * be sent to a Payment Link; with that gone they see the temporary
 * unavailability state rather than a button that leads nowhere.
 */
export async function billingSetupPurpose(agencyId: number): Promise<PaymentMethodPurpose | null> {
  for (const purpose of ['card_update', 'reactivate', 'trial_start'] as const) {
    if (await isCardSetupEligible(agencyId, purpose)) return purpose
  }
  return null
}
