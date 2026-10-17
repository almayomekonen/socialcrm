'use server'

import { getUser } from '@/db/auth'
import { track } from '@/lib/analytics/track'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { ONE_OFF_AGENCY_ID, sendOneOffReminder, type OneOffResult } from '@/lib/ownerWhatsappReminders/oneOffSend'

/**
 * The one-off owner-reminder test, from the platform owner's /admin/whatsapp
 * session instead of the CRON_SECRET route. Same capability, same safeguards:
 * every gate (configured recipient, agency 103, allowlist, consent,
 * eligibility, quiet hours, single use, no retry) lives in
 * `sendOneOffReminder`, which this only calls.
 *
 * THE PLATFORM-OWNER SESSION BOUNDARY, as in actions/support/admin.ts: a Server
 * Action is an independently addressable endpoint, so ownership is re-checked
 * here, never inherited from the page. A suspended owner is refused too. The
 * mode is fixed to `immediate`; the only input is the conversation id.
 *
 * Each attempt is audited (`owner_wa_one_off_send`) with ids and outcomes
 * only. An `unknown` outcome is final: nothing here retries.
 */

export type OwnerWaOneOffActionResult = OneOffResult | { outcome: 'forbidden' } | { outcome: 'invalid' } | { outcome: 'error' }

async function requireActivePlatformOwner(): Promise<{ id: number } | null> {
  const user = await getUser()
  if (!user || user.suspended === true || !isPlatformOwner(user.email)) return null
  return { id: user.id }
}

function auditProps(conversationId: number, r: OwnerWaOneOffActionResult): Record<string, unknown> {
  const props: Record<string, unknown> = { conversationId, mode: 'immediate', outcome: r.outcome }
  if ('reason' in r) props.reason = r.reason
  if ('scope' in r) props.scope = r.scope
  if ('code' in r) props.code = r.code
  if ('deliveryId' in r) props.deliveryId = r.deliveryId
  return props
}

export async function sendOwnerWaOneOffTestAction(conversationId: unknown): Promise<OwnerWaOneOffActionResult> {
  const owner = await requireActivePlatformOwner()
  if (!owner) return { outcome: 'forbidden' }
  if (!(typeof conversationId === 'number' && Number.isSafeInteger(conversationId) && conversationId > 0)) return { outcome: 'invalid' }

  let result: OwnerWaOneOffActionResult
  try {
    result = await sendOneOffReminder({ conversationId, mode: 'immediate' })
  } catch (err) {
    // An interrupted attempt leaves its delivery `sending`: it is never resent.
    console.error('[OwnerWaReminder][one-off][admin] failed', { conversationId, ownerUserId: owner.id, code: (err as { code?: string })?.code ?? null })
    result = { outcome: 'error' }
  }
  const props = auditProps(conversationId, result)
  console.log('[OwnerWaReminder][one-off][admin]', { ownerUserId: owner.id, ...props })
  await track({ agencyId: ONE_OFF_AGENCY_ID, userId: owner.id, event: 'owner_wa_one_off_send', props })
  return result
}
