'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseSmartReplyAgent } from '@/lib/flags/smartReplyAgentFlags'
import { db } from '@/config/db'
import {
  setMasterEnabled,
  upsertChannelSettings,
  getChannelSettings,
  parseReplyMode,
  clampDelaySeconds,
  MAX_FIXED_BODY_LENGTH,
  type AutoResponseReplyMode,
} from '@/db/autoResponseSettings'
import { deriveBusinessProfile, hashDescription, type BusinessProfile } from '@/lib/inbox/autoresponse/businessProfile'
import { canUseConversationalAgent } from '@/lib/flags/conversationalAgentFlags'
import { normalizeAgentProfile, type AgentProfile } from '@/lib/inbox/autoresponse/conversational/agentProfile'

export type UpdateAutoResponseInput = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  /** The one thing a Smart Agent owner writes. Their own words, kept editable. */
  guidance: string | null
  /** Advanced, optional. Extra behavioural instruction. Never sent verbatim. */
  agentInstructions: string | null
  replyMode: AutoResponseReplyMode
  /** The literal outgoing message. Sent verbatim, 'fixed' only. */
  fixedBody: string | null
  delaySeconds: number
  /** Supplied inline when the account has no business name yet. */
  businessName?: string | null
  /**
   * Greeting, persona, tone, FAQ, escalation topics. Accepted only for an agency
   * on the conversational agent; ignored (the column is not touched) otherwise.
   * Omitted = left as stored.
   */
  agentProfile?: AgentProfile | null
}

export type UpdateAutoResponseResult =
  | { ok: true; profileDerived: boolean; unsupportedRequests: string[] }
  | { ok: false; reason: string }

const CHANNEL = 'whatsapp'
const MAX_GUIDANCE_LENGTH = 4000

/**
 * The owner picks a reply style; the engine mode follows from it.
 *
 * 'ai'    — Smart Agent. The conversational agent.
 * 'fixed' — one verbatim message, exactly once. That IS acknowledge mode, and
 *           its one-shot behaviour is the point rather than a limitation.
 *
 * GATED. Turning Smart Agent into the conversational agent changes what an
 * existing customer's WhatsApp does, so it happens only for an agency the
 * rollout flag names. For everyone else this returns `undefined` and
 * `upsertChannelSettings` leaves the stored `mode` exactly as it was.
 */
function modeForReplyMode(
  replyMode: AutoResponseReplyMode,
  agencyId: number,
): 'acknowledge' | 'qualify' | undefined {
  if (replyMode === 'fixed') return 'acknowledge'
  return canUseSmartReplyAgent(agencyId) ? 'qualify' : undefined
}

export async function updateAutoResponseSettings(input: UpdateAutoResponseInput): Promise<UpdateAutoResponseResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const dailyCap = Number.isFinite(input.dailyCap) ? Math.min(Math.max(Math.floor(input.dailyCap), 0), 100_000) : 200
  const guidance = (input.guidance ?? '').trim().slice(0, MAX_GUIDANCE_LENGTH) || null
  const agentInstructions = (input.agentInstructions ?? '').trim().slice(0, MAX_GUIDANCE_LENGTH) || null
  const replyMode = parseReplyMode(input.replyMode)
  const delaySeconds = clampDelaySeconds(input.delaySeconds)
  const fixedBody =
    replyMode === 'fixed' ? (input.fixedBody ?? '').trim().slice(0, MAX_FIXED_BODY_LENGTH) || null : (input.fixedBody ?? null)

  if (replyMode === 'fixed' && !fixedBody) return { ok: false, reason: 'fixed_body_required' }

  // ── The business name ──────────────────────────────────────────────────────
  // The agent greets by name, so Smart Agent needs one. It is normally already
  // on the account; when it is not, the form asks inline rather than sending the
  // owner to a different settings page mid-setup.
  const agency = await db('agencies').where({ id: user.agencyId }).first('id', 'name')
  const storedName = typeof agency?.name === 'string' ? agency.name.trim() : ''
  const suppliedName = (input.businessName ?? '').trim().slice(0, 120)
  let businessName = storedName
  if (replyMode === 'ai') {
    if (!storedName && !suppliedName) return { ok: false, reason: 'business_name_required' }
    if (!storedName && suppliedName) {
      await db('agencies').where({ id: user.agencyId }).update({ name: suppliedName })
      businessName = suppliedName
    }
  }

  // ── Derive the profile ─────────────────────────────────────────────────────
  // Once, here — never per customer message. Skipped when the description has
  // not changed, so re-saving a daily cap costs no model call.
  const existing = await getChannelSettings(user.agencyId, CHANNEL)
  const descriptionChanged = (existing?.guidance ?? null) !== guidance
  const storedProfile = existing?.businessProfile ?? null
  const profileStillMatches =
    storedProfile !== null && guidance !== null && storedProfile.sourceHash === hashDescription(guidance)

  let businessProfile: BusinessProfile | null | undefined
  let profileDerived = profileStillMatches
  let unsupportedRequests = storedProfile?.unsupportedRequests ?? []
  let derivationFailed = false

  if (replyMode === 'ai' && guidance && (descriptionChanged || !profileStillMatches)) {
    const derived = await deriveBusinessProfile({ agencyId: user.agencyId, description: guidance, businessName })
    if (derived.ok) {
      businessProfile = derived.profile
      profileDerived = true
      unsupportedRequests = derived.profile.unsupportedRequests
    } else {
      // The owner's words are never lost. The profile is CLEARED rather than
      // left stale, so the agent falls back to reading the description as prose
      // instead of answering from text the owner has since edited away.
      businessProfile = null
      profileDerived = false
      derivationFailed = true
      unsupportedRequests = []
    }
  } else if (replyMode === 'ai' && !guidance) {
    businessProfile = null
    profileDerived = false
    unsupportedRequests = []
  }

  await setMasterEnabled(user.agencyId, !!input.masterEnabled)
  await upsertChannelSettings({
    agencyId: user.agencyId,
    channel: CHANNEL,
    enabled: !!input.channelEnabled,
    quietHours: {},
    dailyCap,
    guidance,
    agentInstructions,
    businessProfile,
    mode: modeForReplyMode(replyMode, user.agencyId),
    // Validated and length-capped here and again in the data layer; owner text only.
    ...(input.agentProfile !== undefined && canUseConversationalAgent(user.agencyId)
      ? { agentProfile: input.agentProfile ? normalizeAgentProfile(input.agentProfile) : null }
      : {}),
    replyMode,
    fixedBody,
    delaySeconds,
    updatedBy: user.id,
  })

  revalidatePath('/settings/auto-response')

  // A recoverable error: everything the owner typed IS saved, and the agent
  // still works from the raw description. Only the structured view is missing,
  // and pressing save again retries it.
  if (derivationFailed) return { ok: false, reason: 'profile_derivation_failed' }

  return { ok: true, profileDerived, unsupportedRequests }
}
