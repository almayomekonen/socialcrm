import { cache } from 'react'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState, hasActiveProductAccess, type TrialStatus } from '@/lib/trial'

export type ProductAccess = { status: TrialStatus | 'UNKNOWN'; hasAccess: boolean }

/**
 * Canonical product-access resolver — the SINGLE source of truth for
 * "does this agency currently have the product?". Reuses the existing trial
 * state machine only (getAgencyTrial → getTrialState → hasActiveProductAccess);
 * it introduces NO second access model.
 *
 *   PAID / TRIAL_ACTIVE / LEGACY → hasAccess: true
 *   NEVER_STARTED / TRIAL_EXPIRED → hasAccess: false  (with the status, so
 *                                   callers can pick a typed reason)
 *
 * Wrapped in React `cache()` so many callers within ONE request — the layout
 * render gate, several server actions, the AI router — share a SINGLE DB read.
 *
 * FAILS OPEN: a transient DB error, or a missing agency row, resolves to
 * hasAccess: true so a paying customer is never wrongly blocked by
 * infrastructure. Only a CONFIRMED NEVER_STARTED / TRIAL_EXPIRED denies. This
 * mirrors the AI gate and the layout's fail-open-to-LEGACY behavior.
 */
export const getAgencyProductAccess = cache(async (agencyId: number): Promise<ProductAccess> => {
  try {
    const row = await getAgencyTrial(agencyId)
    if (!row) return { status: 'UNKNOWN', hasAccess: true } // missing row → fail open
    const status = getTrialState(row, new Date()).status
    return { status, hasAccess: hasActiveProductAccess(status) }
  } catch (err) {
    console.error('[access] product-access read failed; failing open', { agencyId, err: String(err) })
    return { status: 'UNKNOWN', hasAccess: true } // infra error → fail open
  }
})
