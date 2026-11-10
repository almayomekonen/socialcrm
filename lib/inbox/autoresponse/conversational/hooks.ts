import 'server-only'
import { canUseConversationalAgent } from '@/lib/flags/conversationalAgentFlags'
import { notifyEvent } from '@/lib/notifications/emit'
import type { Qualification } from '../qualification'
import type { QualifyGenResult } from '../qualify'
import {
  businessTurnCount,
  isConversationMode,
  nextConversationMemory,
  parseConversationMemory,
  shouldNotifyPersonal,
  socialHintHolds,
  type ConversationMemory,
  type ConversationMode,
} from './mode'
import { loadCrmContext, type CrmContext } from './crmContext'
import type { ConversationalPromptContext } from './prompt'
import { validateConversationalReply, type PersonalCheck } from './validatePersonal'

/**
 * The conversational agent's hooks into the qualify worker
 * (qualifyWorker.ts). Each is called at one point of the existing pipeline and
 * returns a decision; the worker keeps every gate, send and state write it had.
 *
 * `startConversationalTurn` returns null for an agency that is not on
 * IRE_CONVERSATIONAL_AGENCY_IDS, and the worker then runs exactly as before.
 */

export type ConversationalTurn = {
  memory: ConversationMemory | null
  crm: CrmContext
  /** The last turn was personal or mixed, recently and confidently enough to relax the sales turn rules. */
  socialHint: boolean
  nowMs: number
}

export async function startConversationalTurn(input: {
  agencyId: number
  leadId: number | null
  qualification: Qualification
  nowMs: number
}): Promise<ConversationalTurn | null> {
  if (!canUseConversationalAgent(input.agencyId)) return null
  const memory = parseConversationMemory(input.qualification.conversation)
  const crm = await loadCrmContext({ agencyId: input.agencyId, leadId: input.leadId, nowMs: input.nowMs })
  return { memory, crm, socialHint: socialHintHolds(memory, input.nowMs), nowMs: input.nowMs }
}

export function promptContextFor(turn: ConversationalTurn, opts: { personalRepair?: boolean } = {}): ConversationalPromptContext {
  return { crm: turn.crm, memory: turn.memory, nowMs: turn.nowMs, ...(opts.personalRepair ? { personalRepair: true } : {}) }
}

/** Personal turns do not consume the discovery-question budget. */
export function discoveryTurnCount(turn: ConversationalTurn | null, aiTurnCount: number): number {
  return turn ? businessTurnCount(aiTurnCount, turn.memory) : aiTurnCount
}

/** The mode this generation reported; 'unclear' when it reported none. */
export function modeOf(gen: QualifyGenResult): ConversationMode {
  return gen.ok && isConversationMode(gen.conversationMode) ? gen.conversationMode : 'unclear'
}

export function checkConversationalReply(gen: QualifyGenResult, businessName: string | null): PersonalCheck {
  if (!gen.ok) return { ok: true }
  return validateConversationalReply({ reply: gen.reply, mode: modeOf(gen), businessName, personalClaims: gen.personalClaims === true })
}

/** The memory to persist with this turn, and whether the owner should be told now. */
export function memoryAfterTurn(turn: ConversationalTurn, gen: QualifyGenResult, opts: { willSend: boolean }): { memory: ConversationMemory; notify: boolean } {
  const mode = modeOf(gen)
  const confidence = gen.ok && gen.modeConfidence ? gen.modeConfidence : 'low'
  const notify = opts.willSend && shouldNotifyPersonal(turn.memory, { mode, confidence })
  return { memory: nextConversationMemory(turn.memory, { mode, confidence, nowMs: turn.nowMs, notified: notify }), notify }
}

/**
 * Tell the owner, once, that the agent is answering a personal conversation.
 * Called only after the reply was actually sent. A failure here never affects
 * the conversation: the reply is already out and the memory records nothing
 * that is not true about the send.
 */
export async function notifyPersonalConversation(input: { agencyId: number; conversationId: number; leadId: number | null; customerName: string | null }): Promise<void> {
  try {
    await notifyEvent({
      type: 'conversation.personal_detected',
      agencyId: input.agencyId,
      entityType: 'conversation',
      entityId: input.conversationId,
      actorUserId: null,
      occurredAt: new Date(),
      payload: { leadId: input.leadId, leadName: input.customerName, provider: 'whatsapp' },
    })
  } catch (e) {
    console.error('[IRE-CONVERSATIONAL] personal notification failed', { conversationId: input.conversationId, reason: (e as Error)?.message })
  }
}
