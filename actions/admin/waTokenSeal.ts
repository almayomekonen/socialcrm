'use server'

import { getUser } from '@/db/auth'
import { track } from '@/lib/analytics/track'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { TOKEN_SEAL_CONFIRMATION } from '@/lib/whatsapp/tokenSealConfirmation'
import {
  applyWhatsappTokenSeal,
  inspectWhatsappTokens,
  type TokenSealApplyResult,
  type TokenSealInspection,
} from '@/lib/whatsapp/tokenSealJob'

/**
 * The WhatsApp token sealing job, from the platform owner's /admin/whatsapp session.
 *
 * THE PLATFORM-OWNER SESSION BOUNDARY, as in actions/admin/ownerWaOneOff.ts: a Server
 * Action is an independently addressable endpoint, so ownership is re-checked here,
 * never inherited from the page. A suspended owner is refused.
 *
 * Apply needs BOTH the fingerprint from a fresh inspection and the typed confirmation
 * phrase. Every call is audited (`whatsapp_token_seal_job`) with counts and row ids only.
 */

export type TokenSealInspectResult = { outcome: 'ok'; inspection: TokenSealInspection } | { outcome: 'forbidden' } | { outcome: 'error' }
export type TokenSealApplyActionResult = TokenSealApplyResult | { outcome: 'forbidden' } | { outcome: 'invalid' } | { outcome: 'error' }

async function requireActivePlatformOwner(): Promise<{ id: number; agencyId: number } | null> {
  const user = await getUser()
  if (!user || user.suspended === true || !isPlatformOwner(user.email) || !user.agencyId) return null
  return { id: user.id, agencyId: user.agencyId }
}

function counts(i: TokenSealInspection) {
  return { total: i.total, sealed: i.sealed, plaintext: i.plaintext, plaintextIds: i.plaintextIds, unreadableIds: i.unreadableIds }
}

async function audit(owner: { id: number; agencyId: number }, props: Record<string, unknown>) {
  console.log('[admin][wa-token-seal]', JSON.stringify({ ownerUserId: owner.id, ...props }))
  await track({ agencyId: owner.agencyId, userId: owner.id, event: 'whatsapp_token_seal_job', props })
}

/** Dry run and verify: read-only. */
export async function inspectWhatsappTokensAction(): Promise<TokenSealInspectResult> {
  const owner = await requireActivePlatformOwner()
  if (!owner) return { outcome: 'forbidden' }
  try {
    const inspection = await inspectWhatsappTokens()
    await audit(owner, { mode: 'inspect', ...counts(inspection) })
    return { outcome: 'ok', inspection }
  } catch (err) {
    console.error('[admin][wa-token-seal] inspect failed', { name: (err as Error)?.name ?? null })
    return { outcome: 'error' }
  }
}

export async function applyWhatsappTokenSealAction(input: unknown): Promise<TokenSealApplyActionResult> {
  const owner = await requireActivePlatformOwner()
  if (!owner) return { outcome: 'forbidden' }
  const { planFingerprint, confirmation } = (input ?? {}) as { planFingerprint?: unknown; confirmation?: unknown }
  if (typeof planFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(planFingerprint) || confirmation !== TOKEN_SEAL_CONFIRMATION) {
    await audit(owner, { mode: 'apply', outcome: 'invalid' })
    return { outcome: 'invalid' }
  }
  try {
    const result = await applyWhatsappTokenSeal(planFingerprint)
    if (result.outcome === 'applied') {
      await audit(owner, {
        mode: 'apply',
        outcome: 'applied',
        sealedIds: result.sealedIds,
        changedConcurrentlyIds: result.changedConcurrentlyIds,
        failedIds: result.failedIds,
        after: counts(result.after),
      })
    } else {
      await audit(owner, { mode: 'apply', outcome: result.outcome, ...counts(result.inspection) })
    }
    return result
  } catch (err) {
    console.error('[admin][wa-token-seal] apply failed', { name: (err as Error)?.name ?? null })
    return { outcome: 'error' }
  }
}
