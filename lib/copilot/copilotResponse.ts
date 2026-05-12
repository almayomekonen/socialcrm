import type { LeadFollowup } from '@/lib/ai/prompts/leadFollowup'
import type { LeadNextStep } from '@/lib/ai/prompts/leadNextStep'
import type { LeadAskAnswer } from '@/lib/ai/prompts/leadAskQuestion'

export type CopilotActionId = 'draft-followup-message' | 'next-best-step' | 'ask-question'

/** Predefined intents fired through the Tools popover (not freeform). */
export type PredefinedCopilotActionId = Exclude<CopilotActionId, 'ask-question'>

export type CopilotResponsePayload =
  | { actionId: 'draft-followup-message'; data: LeadFollowup }
  | { actionId: 'next-best-step'; data: LeadNextStep }
  | { actionId: 'ask-question'; data: LeadAskAnswer }

export type CopilotResponseErrorReason =
  | 'disabled'
  | 'forbidden'
  | 'no-providers'
  | 'over-quota'
  | 'all-providers-failed'
  | 'invalid-input'
  | 'unknown'
