import type { AutoResponseReplyMode } from '@/db/autoResponseSettings'
import type { MessageKey } from '@/lib/i18n/translate'
import type { AgentProfile } from '@/lib/inbox/autoresponse/conversational/agentProfile'
import type { OptionState } from '@/lib/inbox/autoresponse/responderChoice'
import type { ResponseMethod } from '@/lib/inbox/autoresponse/responseMethod'

/**
 * The auto-response form's props and its editable draft. Moved out of
 * `AutoResponseSettingsForm.tsx` (over the 250-line soft limit).
 */
export type AutoResponseFormProps = {
  masterEnabled: boolean
  channelEnabled: boolean
  dailyCap: number
  guidance: string | null
  agentInstructions: string | null
  replyMode: AutoResponseReplyMode
  fixedBody: string | null
  delaySeconds: number
  /** From the account. Empty ⇒ the form asks for it inline. */
  businessName: string
  /** Conversational agent only: the owner's structured agent profile. Undefined ⇒ the section is not shown. */
  agentProfile?: AgentProfile | null
  /** The response method as stored, and what each option can do for this agency (computed on the server). */
  method: MethodProps
}

export type MethodProps = {
  stored: ResponseMethod
  /** Whether the questionnaire can run. Null: no settings row yet. */
  questionnaire: OptionState | null
  /** Choosing the AI holds a conversation (vs one AI reply). */
  aiConversational: boolean
  /** Stored as questionnaire, but the questionnaire cannot speak. */
  stalled: boolean
  builderHref?: string
}

export type Draft = {
  master: boolean
  channel: boolean
  dailyCap: string
  guidance: string
  agentInstructions: string
  /** The agent's reply style, kept for when the agent answers. 'fixed' iff method is 'fixed', except while the questionnaire holds it. */
  replyMode: AutoResponseReplyMode
  method: ResponseMethod
  fixedBody: string
  delaySeconds: string
  businessName: string
}

export const BODY_MAX = 1000

export function toDraft(p: AutoResponseFormProps): Draft {
  return {
    master: p.masterEnabled,
    channel: p.channelEnabled,
    dailyCap: String(p.dailyCap),
    guidance: p.guidance ?? '',
    agentInstructions: p.agentInstructions ?? '',
    replyMode: p.replyMode,
    method: p.method.stored,
    fixedBody: p.fixedBody ?? '',
    delaySeconds: String(p.delaySeconds),
    businessName: p.businessName ?? '',
  }
}

/** Picking a method in the draft. The questionnaire leaves the agent's reply style as it is. */
export function withMethod(d: Draft, method: ResponseMethod): Draft {
  if (method === 'questionnaire') return { ...d, method }
  return { ...d, method, replyMode: method === 'fixed' ? 'fixed' : 'ai' }
}

/**
 * A refused save, as a CODE (`updateAutoResponseSettings`' `reason`); the form
 * words it from the catalog.
 */
export type SaveErrorCode =
  | 'fixed_body_required'
  | 'business_name_required'
  | 'profile_derivation_failed'
  | 'method_conflict'
  | 'method_unavailable'
  | 'unknown'

const KNOWN: readonly string[] = ['fixed_body_required', 'business_name_required', 'profile_derivation_failed', 'method_conflict', 'method_unavailable']

export function saveErrorCode(reason: string): SaveErrorCode {
  return KNOWN.includes(reason) ? (reason as SaveErrorCode) : 'unknown'
}

export const SAVE_ERROR_KEY = {
  fixed_body_required: 'admin.autoResponse.error.fixed_body_required',
  business_name_required: 'admin.autoResponse.error.business_name_required',
  profile_derivation_failed: 'admin.autoResponse.error.profile_derivation_failed',
  // The method switch's own refusals keep the wording the instant switch used.
  method_conflict: 'admin.autoResponse.responder.error.conflict',
  method_unavailable: 'admin.autoResponse.responder.error.unavailable',
  unknown: 'admin.autoResponse.error.unknown',
} as const satisfies Record<SaveErrorCode, MessageKey>
