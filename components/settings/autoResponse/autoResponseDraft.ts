import type { AutoResponseReplyMode } from '@/db/autoResponseSettings'

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
