import type { LeadFollowup } from '@/lib/ai/prompts/leadFollowup'
import type { LeadNextStep } from '@/lib/ai/prompts/leadNextStep'
import type { LeadAskAnswer } from '@/lib/ai/prompts/leadAskQuestion'
import type { ConversationalReply } from '@/lib/ai/prompts/conversationalReply'

export type CopilotActionId = 'draft-followup-message' | 'next-best-step' | 'ask-question' | 'drive-results' | 'conversational'

export type PredefinedCopilotActionId = Exclude<CopilotActionId, 'ask-question' | 'drive-results' | 'conversational'>

export type DriveResultItem = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  url: string
  thumbnailUrl?: string
}

export type DriveResults = {
  intro: string
  mode: 'specific' | 'generic'
  results: DriveResultItem[]
}

export type CopilotResponsePayload =
  | { actionId: 'draft-followup-message'; data: LeadFollowup }
  | { actionId: 'next-best-step'; data: LeadNextStep }
  | { actionId: 'ask-question'; data: LeadAskAnswer }
  | { actionId: 'drive-results'; data: DriveResults }
  | { actionId: 'conversational'; data: ConversationalReply }

export type CopilotResponseErrorReason =
  | 'disabled'
  | 'forbidden'
  | 'no-providers'
  | 'over-quota'
  | 'all-providers-failed'
  | 'invalid-input'
  | 'subscription-required'
  | 'trial-not-started'
  | 'ai-credits-exhausted'
  | 'unknown'
