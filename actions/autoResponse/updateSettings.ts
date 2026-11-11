'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseSmartReplyAgent } from '@/lib/flags/smartReplyAgentFlags'
import { canUseWhatsappQuestionnaire } from '@/lib/flags/whatsappQuestionnaireFlags'
import { parseQuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
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
import { checkMethodChange, isResponseMethod, methodWrite, type MethodWrite, type ResponseMethod } from '@/lib/inbox/autoresponse/responseMethod'

/**
 * NOTE (architecture-rules §6): ~250 lines, at the soft limit on purpose. It is
 * one linear save — validate, derive the profile, then one transaction — and
 * splitting the transaction body out would pass every validated value across a
 * file boundary for no readability gain.
 */

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
  /**
   * The response method (lib/inbox/autoresponse/responseMethod). When given, it
   * decides `responder`, `replyMode` and `mode` — written with everything else
   * in one transaction — and `replyMode` above is ignored. Omitted: the reply
   * style alone decides, exactly as before, and `responder` is not touched.
   */
  method?: ResponseMethod
  /** The method the page showed as stored. A different stored value is a conflict, never an overwrite. */
  methodFrom?: ResponseMethod
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

class MethodRefused extends Error {
  constructor(readonly reason: 'method_conflict' | 'method_unavailable') {
    super(reason)
  }
}

export async function updateAutoResponseSettings(input: UpdateAutoResponseInput): Promise<UpdateAutoResponseResult> {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return { ok: false, reason: 'forbidden' }

  const methodGiven = input.method !== undefined
  if (methodGiven && (!isResponseMethod(input.method) || !isResponseMethod(input.methodFrom))) return { ok: false, reason: 'invalid' }
  const method = methodGiven ? (input.method as ResponseMethod) : null

  // ── What the existing row says (read again, locked, inside the transaction) ──
  const existing = await getChannelSettings(user.agencyId, CHANNEL)

  // The method's own columns. The questionnaire leaves the reply style alone, so
  // the agent comes back exactly as the owner left it.
  const write: MethodWrite | null = method ? methodWrite(method, canUseSmartReplyAgent(user.agencyId)) : null
  const replyMode = write
    ? (write.replyMode ?? existing?.replyMode ?? parseReplyMode(input.replyMode))
    : parseReplyMode(input.replyMode)
  const mode = write ? write.mode : modeForReplyMode(replyMode, user.agencyId)
  // The agent's own requirements apply only when the agent is what will answer.
  const agentAnswers = method !== 'questionnaire'

  const dailyCap = Number.isFinite(input.dailyCap) ? Math.min(Math.max(Math.floor(input.dailyCap), 0), 100_000) : 200
  const guidance = (input.guidance ?? '').trim().slice(0, MAX_GUIDANCE_LENGTH) || null
  const agentInstructions = (input.agentInstructions ?? '').trim().slice(0, MAX_GUIDANCE_LENGTH) || null
  const delaySeconds = clampDelaySeconds(input.delaySeconds)
  const fixedBody =
    replyMode === 'fixed' ? (input.fixedBody ?? '').trim().slice(0, MAX_FIXED_BODY_LENGTH) || null : (input.fixedBody ?? null)

  if (agentAnswers && replyMode === 'fixed' && !fixedBody) return { ok: false, reason: 'fixed_body_required' }

  // ── The business name ──────────────────────────────────────────────────────
  // The agent greets by name, so Smart Agent needs one. It is normally already
  // on the account; when it is not, the form asks inline rather than sending the
  // owner to a different settings page mid-setup.
  const agency = await db('agencies').where({ id: user.agencyId }).first('id', 'name')
  const storedName = typeof agency?.name === 'string' ? agency.name.trim() : ''
  const suppliedName = (input.businessName ?? '').trim().slice(0, 120)
  let businessName = storedName
  let nameToStore: string | null = null
  if (agentAnswers && replyMode === 'ai') {
    if (!storedName && !suppliedName) return { ok: false, reason: 'business_name_required' }
    if (!storedName && suppliedName) {
      nameToStore = suppliedName
      businessName = suppliedName
    }
  }

  // ── Derive the profile ─────────────────────────────────────────────────────
  // Once, here — never per customer message, and never inside the transaction
  // (a model call must not hold a row lock). Skipped when the description has
  // not changed, so re-saving a daily cap costs no model call, and skipped while
  // the questionnaire answers (the agent is not running).
  const descriptionChanged = (existing?.guidance ?? null) !== guidance
  const storedProfile = existing?.businessProfile ?? null
  const profileStillMatches =
    storedProfile !== null && guidance !== null && storedProfile.sourceHash === hashDescription(guidance)

  let businessProfile: BusinessProfile | null | undefined
  let profileDerived = profileStillMatches
  let unsupportedRequests = storedProfile?.unsupportedRequests ?? []
  let derivationFailed = false

  if (agentAnswers && replyMode === 'ai' && guidance && (descriptionChanged || !profileStillMatches)) {
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
  } else if (agentAnswers && replyMode === 'ai' && !guidance) {
    businessProfile = null
    profileDerived = false
    unsupportedRequests = []
  }

  // ── One transaction ────────────────────────────────────────────────────────
  // The method is checked against the row AS IT IS NOW (locked), so a stale page
  // or a second tab can neither overwrite a newer choice nor switch the agency to
  // a method it cannot run. A refusal writes nothing at all.
  try {
    await db.transaction(async (trx) => {
      if (method && input.methodFrom) {
        const row = await trx('auto_response_settings')
          .where({ agencyId: user.agencyId, channel: CHANNEL })
          .forUpdate()
          .first('responder', 'mode', 'replyMode', 'questionnaire')
        const check = checkMethodChange(
          row
            ? {
                responder: row.responder,
                mode: row.mode,
                replyMode: row.replyMode,
                questionnaireAllowed: canUseWhatsappQuestionnaire(user.agencyId),
                questionnairePublished: parseQuestionnaireDefinition(row.questionnaire ?? null).ok,
              }
            : null,
          { from: input.methodFrom, to: method },
        )
        if (check.ok === false) throw new MethodRefused(check.reason === 'conflict' ? 'method_conflict' : 'method_unavailable')
      }

      if (nameToStore) await trx('agencies').where({ id: user.agencyId }).update({ name: nameToStore })
      await setMasterEnabled(user.agencyId, !!input.masterEnabled, trx)
      await upsertChannelSettings(
        {
          agencyId: user.agencyId,
          channel: CHANNEL,
          enabled: !!input.channelEnabled,
          quietHours: {},
          dailyCap,
          guidance,
          agentInstructions,
          businessProfile,
          mode,
          ...(write ? { responder: write.responder } : {}),
          // Validated and length-capped here and again in the data layer; owner text only.
          ...(input.agentProfile !== undefined && canUseConversationalAgent(user.agencyId)
            ? { agentProfile: input.agentProfile ? normalizeAgentProfile(input.agentProfile) : null }
            : {}),
          replyMode,
          fixedBody,
          delaySeconds,
          updatedBy: user.id,
        },
        trx,
      )
    })
  } catch (err) {
    if (err instanceof MethodRefused) return { ok: false, reason: err.reason }
    throw err
  }

  revalidatePath('/settings/auto-response')

  // A recoverable error: everything the owner typed IS saved, and the agent
  // still works from the raw description. Only the structured view is missing,
  // and pressing save again retries it.
  if (derivationFailed) return { ok: false, reason: 'profile_derivation_failed' }

  return { ok: true, profileDerived, unsupportedRequests }
}
