'use server'

import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { startCardSetupForUser, type StartCardSetupInput, type StartCardSetupResult } from '@/lib/payments/cardTrial/startCardSetup'
import { getCardSetupStateForAgency, type CardSetupState } from '@/lib/payments/cardTrial/setupStatus'
import { refreshCardSetupState } from '@/lib/payments/cardTrial/recoverCardSetup'

const PURPOSES = new Set(['trial_start', 'card_update', 'reactivate'])

export async function startCardSetup(input: StartCardSetupInput): Promise<StartCardSetupResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }
  if (!input || !PURPOSES.has(input.purpose)) return { error: 'not_eligible' }
  return startCardSetupForUser(
    { id: user.id, agencyId: user.agencyId, email: user.email ?? null, role: user.role },
    {
      purpose: input.purpose,
      fullName: typeof input.fullName === 'string' ? input.fullName : undefined,
      phone: typeof input.phone === 'string' ? input.phone : undefined,
      acceptedTerms: input.acceptedTerms === true,
      // Forwarded explicitly, like every other field: this wrapper rebuilds the
      // input as an allow-list so nothing unvetted reaches the domain. That is
      // also why omitting a NEW field is silent — the property is simply absent
      // and every remaining one is optional, so the compiler sees nothing wrong
      // and the server reads it as "not consented".
      acceptedCardStorage: input.acceptedCardStorage === true,
      returnTo: input.returnTo === 'credits' ? 'credits' : undefined,
    },
  )
}

/**
 * The return page polls this. When a setup is still `verifying` but its callback
 * already arrived, the verification is retried first: a callback that could not
 * be verified at the time (the evidence gate was closed for that environment)
 * would otherwise leave a saved card and no trial forever, with nothing to
 * re-trigger it — Grow does not resend an update it already got a 200 for.
 *
 * Recovery is the ordinary verified path (recoverPendingCardSetup →
 * confirmCardSetup), so it is idempotent and agency-scoped: a second pass finds
 * the row no longer pending. A failure here never fails the poll — the caller
 * gets the true current state either way.
 */
export async function getCardSetupStatus(): Promise<CardSetupState> {
  try {
    const user = await requireAgencyUser()
    return await refreshCardSetupState(user.agencyId)
  } catch (err) {
    if (err instanceof AuthError) return { state: 'verifying', callbackReceived: false, firstChargeAt: null, chargesEnabled: false, sandbox: false }
    throw err
  }
}
