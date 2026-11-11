import type { ReactNode } from 'react'
import type { AutoResponseReplyMode } from '@/db/autoResponseSettings'
import type { MessageKey } from '@/lib/i18n/translate'
import type { AgentProfile } from '@/lib/inbox/autoresponse/conversational/agentProfile'

/**
 * The auto-response form's props and its editable draft. Moved out of
 * `AutoResponseSettingsForm.tsx` (over the 250-line soft limit) unchanged.
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
  /** The response-method selector (AI agent / questionnaire), rendered under the master switch. */
  responderSlot?: ReactNode
  /**
   * False while the questionnaire is the stored responder: the agent's reply
   * style, profile and preview are hidden (their values stay in the draft, so a
   * save writes them back unchanged). Undefined ⇒ shown, as before.
   */
  agentSettingsVisible?: boolean
}

export type Draft = {
  master: boolean
  channel: boolean
  dailyCap: string
  guidance: string
  agentInstructions: string
  replyMode: AutoResponseReplyMode
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
    fixedBody: p.fixedBody ?? '',
    delaySeconds: String(p.delaySeconds),
    businessName: p.businessName ?? '',
  }
}

/**
 * A refused save, as a CODE (`updateAutoResponseSettings`' `reason`); the form
 * words it from the catalog. Before i18n the form held the Hebrew sentence and
 * compared sentences to tell which field it belonged to — it now compares codes
 * (same outcome: only these two reasons ever produced those two sentences).
 */
export type SaveErrorCode = 'fixed_body_required' | 'business_name_required' | 'profile_derivation_failed' | 'unknown'

export function saveErrorCode(reason: string): SaveErrorCode {
  return reason === 'fixed_body_required' || reason === 'business_name_required' || reason === 'profile_derivation_failed' ? reason : 'unknown'
}

export const SAVE_ERROR_KEY = {
  fixed_body_required: 'admin.autoResponse.error.fixed_body_required',
  business_name_required: 'admin.autoResponse.error.business_name_required',
  profile_derivation_failed: 'admin.autoResponse.error.profile_derivation_failed',
  unknown: 'admin.autoResponse.error.unknown',
} as const satisfies Record<SaveErrorCode, MessageKey>
