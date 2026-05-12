import type { FollowUpPulse } from '@/lib/ai/followUpRules'
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from '@/lib/ai/leadStatuses'

export type CopilotContext = CopilotLeadContext

export type LeadStatusTone = 'active' | 'warm' | 'cool' | 'terminal' | 'unknown'

export type CopilotSuggestedAction = {
  id: string
  label: string
  tone: 'urgent' | 'attention' | 'neutral'
}

export type CopilotGlanceFact = {
  id: string
  label: string
  tone: 'urgent' | 'attention' | 'neutral' | 'positive'
}

export type CopilotLeadContext = {
  kind: 'lead'
  leadId: number
  leadName: string
  status: string | null
  statusTone: LeadStatusTone
  pulse: { pulse: FollowUpPulse; label: string } | null
  facts: CopilotGlanceFact[]
  suggestedActions: CopilotSuggestedAction[]
}

export function classifyLeadStatus(status: string | null | undefined): LeadStatusTone {
  if (!status) return 'unknown'
  if (TERMINAL_STATUSES.has(status)) return 'terminal'
  if (ACTIVE_STATUSES.has(status)) return 'active'
  return 'cool'
}
