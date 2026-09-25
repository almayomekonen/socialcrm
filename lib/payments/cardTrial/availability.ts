import { assertGrowRuntime, getGrowApiConfig, isCardRequiredTrialEnabledForAgency, publicAppOrigin } from '@/lib/payments/grow/config'
import { isGrowLocalMockEnabled } from '@/lib/payments/grow/localMock'
import { isCardSetupEligible } from './startCardSetup'
import { getLatestPaymentMethod, type PaymentMethodPurpose } from '@/db/payments/paymentMethods'

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
/**
 * WHY card billing is or is not available, as a non-sensitive reason code.
 *
 * `isCardBillingAvailable` answers yes/no and swallows the cause, which is
 * correct for rendering but useless when a screen says "not right now" and
 * nobody can tell whether that is a missing credential, the wrong environment
 * or an ineligible account. Production had exactly that problem: the page
 * logged nothing, so the only way to distinguish the cases was to guess.
 *
 * Returns the thrown error's CODE only — `grow.runtime.env_mode_mismatch`,
 * `grow.config.user_id_missing` and friends. Those strings name a condition;
 * none of them contains a credential, a token or an identifier.
 */
export function describeCardBillingAvailability(): { ok: boolean; reason: string } {
  if (isGrowLocalMockEnabled()) return { ok: true, reason: 'local_mock' }
  try {
    assertGrowRuntime()
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err) }
  }
  try {
    getGrowApiConfig()
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err) }
  }
  try {
    publicAppOrigin()
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err) }
  }
  return { ok: true, reason: 'ok' }
}

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

/**
 * What the welcome screen must show a registered account that has no trial yet.
 *
 * The journey is: register → save a card → verify it server-to-server → only
 * then the 7 days start. Between the redirect and the verified callback the
 * account is simply not activated, and the screen has to say that rather than
 * hand the customer the form again — offering it back both hides the truth and
 * invites a second setup that supersedes the pending one.
 *
 *   'setup'       no card saved yet, and a setup can complete → show the form
 *   'awaiting'    a setup is pending verification → say so, offer nothing
 *   'unavailable' the provider cannot complete a setup → say so, promise nothing
 *
 * 'unavailable' matters most: with the card wall on and no way to finish a
 * setup, a new registration would otherwise be stranded behind a form that
 * cannot work.
 */
export type WelcomeCardStage = 'setup' | 'awaiting' | 'unavailable'

export async function welcomeCardStage(agencyId: number): Promise<WelcomeCardStage> {
  const latest = await getLatestPaymentMethod(agencyId)
  if (latest?.status === 'pending') return 'awaiting'
  // An 'active' card with no trial started is a verified setup whose trial write
  // has not landed yet — still awaiting, never a fresh form.
  if (latest?.status === 'active') return 'awaiting'
  return isCardBillingAvailable() ? 'setup' : 'unavailable'
}

/**
 * Is there any way to bill this agency if we start a trial for it?
 *
 * After Payment Links a saved card is the only billing path, and a card is
 * asked for exactly where the card-required flow is enabled — globally, or for
 * an allowlisted account during the production validation window.
 *
 * So this is the "never open a trial we cannot bill" rule. A click-to-start
 * trial opened outside that set would reach day seven with no stored card to
 * charge and no link to send: the customer loses access having been told they
 * were on a trial. It changes nothing for trials that already exist.
 */
export function hasBillingPath(agencyId: number): boolean {
  return isCardRequiredTrialEnabledForAgency(agencyId)
}

