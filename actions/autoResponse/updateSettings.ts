'use server'

import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import { canUseSmartReplyAgent } from '@/lib/flags/smartReplyAgentFlags'
import {
  setMasterEnabled,
  upsertChannelSettings,
  parseReplyMode,
  clampDelaySeconds,
  MAX_FIXED_BODY_LENGTH,
  type AutoResponseReplyMode,
} from '@/db/autoResponseSettings'

export type UpdateAutoResponseInput = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  /** Business information — what this business is. Never sent verbatim. */
  guidance: string | null
  /** How the agent should converse for this business. Never sent verbatim. */
  agentInstructions: string | null
  replyMode: AutoResponseReplyMode
  /** The literal outgoing message. Sent verbatim, 'fixed' only. */
  fixedBody: string | null
  delaySeconds: number
}

export type UpdateAutoResponseResult = { ok: true } | { ok: false; reason: string }

const CHANNEL = 'whatsapp'
const MAX_GUIDANCE_LENGTH = 1000

/**
 * The owner picks a reply style; the engine mode follows from it.
 *
 * 'ai'    — Smart Reply. The conversational agent, which can hold a real
 *           back-and-forth. This is what `mode: 'qualify'` selects in the worker.
 * 'fixed' — one verbatim message, exactly once. That IS acknowledge mode, and
 *           its one-shot behaviour is the point rather than a limitation.
 *
 * Deriving mode from replyMode rather than exposing it separately keeps the
 * owner from having to choose between two words they have no way to evaluate.
 *
 * GATED. Turning Smart Reply into the conversational agent changes what an
 * existing customer's WhatsApp does, so it happens only for an agency the
 * rollout flag names. For everyone else this returns `undefined`, and
 * `upsertChannelSettings` then leaves the stored `mode` exactly as it was —
 * saving guidance or a daily cap never silently changes how the agent behaves.
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

  if (replyMode === 'fixed' && !fixedBody) {
    return { ok: false, reason: 'fixed_body_required' }
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
    mode: modeForReplyMode(replyMode, user.agencyId),
    replyMode,
    fixedBody,
    delaySeconds,
    updatedBy: user.id,
  })

  revalidatePath('/settings/auto-response')
  return { ok: true }
}
