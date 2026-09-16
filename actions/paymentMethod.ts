'use server'

import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { startCardSetupForUser, type StartCardSetupInput, type StartCardSetupResult } from '@/lib/payments/cardTrial/startCardSetup'
import { getCardSetupStateForAgency, type CardSetupState } from '@/lib/payments/cardTrial/setupStatus'

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
    },
  )
}

export async function getCardSetupStatus(): Promise<CardSetupState> {
  try {
    const user = await requireAgencyUser()
    return await getCardSetupStateForAgency(user.agencyId)
  } catch (err) {
    if (err instanceof AuthError) return { state: 'verifying', callbackReceived: false, firstChargeAt: null }
    throw err
  }
}
