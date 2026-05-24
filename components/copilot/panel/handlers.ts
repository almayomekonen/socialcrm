import type { CopilotActionId, CopilotResponsePayload } from '@/lib/copilot/copilotResponse'
import { generateLeadFollowupMessage } from '@/actions/ai/leadFollowup'
import { generateLeadNextBestStep } from '@/actions/ai/leadNextStep'
import { PREDEFINED_ACTIONS } from '@/lib/copilot/leadActions'

export type PredefinedActionId = Exclude<CopilotActionId, 'ask-question' | 'drive-results' | 'conversational'>

type ActionHandler = {
  id: PredefinedActionId
  label: string
  loadingLabel: string
  fn: (leadId: number) => Promise<{ ok: true; data: any } | { ok: false; reason: string; message?: string }>
  toPayload: (data: any) => CopilotResponsePayload
}

export const HANDLERS: Record<PredefinedActionId, ActionHandler> = {
  'draft-followup-message': {
    ...PREDEFINED_ACTIONS['draft-followup-message'],
    loadingLabel: 'מנסח הודעה…',
    fn: (leadId) => generateLeadFollowupMessage(leadId),
    toPayload: (data) => ({ actionId: 'draft-followup-message', data }),
  },
  'next-best-step': {
    ...PREDEFINED_ACTIONS['next-best-step'],
    loadingLabel: 'בוחן את הצעד הבא…',
    fn: (leadId) => generateLeadNextBestStep(leadId),
    toPayload: (data) => ({ actionId: 'next-best-step', data }),
  },
}
