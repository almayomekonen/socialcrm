import { isEmailBlocked } from '@/db/automations/emailBlocks'

/**
 * DELIVERABILITY, per recipient kind.
 *
 * A hard bounce is an email idea; a carrier rejection is an SMS idea; a
 * disabled webhook endpoint is a third. They share a question — "is this
 * address known to be undeliverable?" — and nothing else, so the answer lives
 * in a lookup keyed by the SUBJECT FIELD the address came from.
 *
 * B6b moved this out of the worker's default wiring, where it was an
 * `if (fieldKey === 'email')`. A channel that gains a block list registers it
 * here; the worker, the laws and the executors are all unchanged.
 *
 * A kind with no registered lookup is NOT blocked. That is the safe default in
 * both directions: we never invent a block that would silently stop a send,
 * and the `requires` check has already guaranteed an address exists.
 */

export type RecipientBlockLookup = (agencyId: number, address: string) => Promise<boolean>

const LOOKUPS: Record<string, RecipientBlockLookup> = {
  email: isEmailBlocked,
}

export async function isRecipientBlocked(agencyId: number, fieldKey: string, address: string): Promise<boolean> {
  const lookup = LOOKUPS[fieldKey]
  return lookup ? lookup(agencyId, address) : false
}

/** Which recipient kinds have a block list today. Pinned in CI. */
export const blockedRecipientKinds = (): readonly string[] => Object.keys(LOOKUPS)
