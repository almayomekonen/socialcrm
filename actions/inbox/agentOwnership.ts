'use server'

/**
 * WhatsApp Agent — the two explicit ownership actions a rep can take on one
 * conversation: pause the agent, and hand it back.
 *
 * These are per-conversation actions inside the existing Automatic Reply
 * experience, not settings. Nothing here is configuration: an owner who never
 * touches either control keeps exactly the behaviour they have now, because
 * sending a message already pauses the agent and always did.
 *
 * TENANCY. `agencyId` is the SESSION's, resolved server-side from the
 * authenticated user, and is never accepted from the browser. Both writers are
 * additionally agency-scoped in SQL — a conversation belonging to another agency
 * matches zero rows and reports false — so a forged conversationId is inert
 * rather than merely unauthorized.
 */
import { revalidatePath } from 'next/cache'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAiState } from '@/db/conversationAiState'
import { returnConversationToAgent, takeOverConversationByRep } from '@/db/conversationHumanPresence'
import { decideReturnToAgent, decideTakeOver } from '@/lib/inbox/autoresponse/agentOwnership'
import { track } from '@/lib/analytics/track'

export type OwnershipResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'invalid-input' | 'forbidden' | 'opted_out' | 'closed' | 'already_active' | 'failed' }

function conversationIdOf(raw: number | string): number | null {
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

/**
 * "I'll answer from here." The agent stops on this conversation until a person
 * explicitly hands it back.
 *
 * Idempotent: taking over a conversation a human already owns reports success
 * with `changed: false` rather than an error the rep has no way to act on.
 */
export async function takeOverConversation(conversationIdRaw: number | string): Promise<OwnershipResult> {
  const conversationId = conversationIdOf(conversationIdRaw)
  if (conversationId == null) return { ok: false, reason: 'invalid-input' }

  const user = await requireAgencyUser().catch(() => null)
  if (!user?.agencyId) return { ok: false, reason: 'forbidden' }

  const current = await getAiState(conversationId).catch(() => null)
  // A conversation the agent has never touched has no row yet; that reads as
  // `new`, which is takeable — a rep can claim a thread before the agent ever
  // speaks in it.
  const decision = decideTakeOver(current?.aiState ?? 'new')
  if (decision.allowed === false) {
    if (decision.reason === 'opted_out') return { ok: false, reason: 'opted_out' }
    return { ok: true, changed: false }
  }

  const changed = await takeOverConversationByRep({ conversationId, agencyId: user.agencyId }).catch(() => false)
  if (!changed) return { ok: false, reason: 'failed' }

  await track({
    agencyId: user.agencyId,
    event: 'auto_response_human_takeover',
    props: { conversationId, source: 'explicit' },
  })
  revalidatePath('/inbox')
  return { ok: true, changed: true }
}

/**
 * "Back to the agent." The ONLY way a paused conversation resumes — there is no
 * timer and no sweep that does this.
 *
 * Refuses on `opted_out` and `closed`. The customer's own stop is not a rep's to
 * lift, and re-engaging a finished conversation is a new approach rather than a
 * resumption. Both refusals are enforced again in SQL.
 */
export async function returnToAgent(conversationIdRaw: number | string): Promise<OwnershipResult> {
  const conversationId = conversationIdOf(conversationIdRaw)
  if (conversationId == null) return { ok: false, reason: 'invalid-input' }

  const user = await requireAgencyUser().catch(() => null)
  if (!user?.agencyId) return { ok: false, reason: 'forbidden' }

  const current = await getAiState(conversationId).catch(() => null)
  const decision = decideReturnToAgent(current?.aiState ?? 'new')
  if (decision.allowed === false) {
    if (decision.reason === 'already_active') return { ok: true, changed: false }
    return { ok: false, reason: decision.reason }
  }

  const changed = await returnConversationToAgent({ conversationId, agencyId: user.agencyId }).catch(() => false)
  if (!changed) return { ok: false, reason: 'failed' }

  await track({
    agencyId: user.agencyId,
    event: 'auto_response_returned_to_agent',
    props: { conversationId, from: current?.aiState ?? 'unknown' },
  })
  revalidatePath('/inbox')
  return { ok: true, changed: true }
}

/** What the banner needs to know. Read-only; safe to call on every render. */
export async function readAgentOwnership(
  conversationIdRaw: number | string,
): Promise<{ aiState: string; humanOwned: boolean } | null> {
  const conversationId = conversationIdOf(conversationIdRaw)
  if (conversationId == null) return null
  const user = await requireAgencyUser().catch(() => null)
  if (!user?.agencyId) return null
  const row = await getAiState(conversationId).catch(() => null)
  if (!row || row.agencyId !== user.agencyId) return null
  return { aiState: row.aiState, humanOwned: row.aiState === 'human_active' || row.aiState === 'escalated' }
}
