'use server'

import {
  LEAD_NEXT_STEP_SYSTEM_PROMPT,
  type LeadNextStep,
  LeadNextStepSchema,
  buildLeadNextStepUserMessage,
  sanitizeLeadNextStep,
} from '@/lib/ai/prompts/leadNextStep'
import { defineCachedLeadAction } from './_defineCachedLeadAction'

const TTL_SECONDS = 60 * 60 * 6 // 6h

export const generateLeadNextBestStep = defineCachedLeadAction<LeadNextStep>({
  kind: 'lead.nextStep',
  schema: LeadNextStepSchema,
  schemaName: 'LeadNextStep',
  schemaDescription: 'הצעד הבא הקונקרטי לקידום הליד, עם נימוק קצר ודרגת דחיפות',
  system: LEAD_NEXT_STEP_SYSTEM_PROMPT,
  buildUserMessage: ({ inputs, leadName }) => buildLeadNextStepUserMessage(inputs, leadName),
  sanitize: (out) => sanitizeLeadNextStep(out),
  cache: {
    keyPrefix: 'lead-next-step',
    ttlSeconds: TTL_SECONDS,
    tags: (leadId) => [`ai-lead-action:next-step:${leadId}`, `ai-lead-action:${leadId}`],
  },
  requiresLeadName: true,
  pollutionLogPrefix: 'sanitizer.nextStep',
  persist: {
    actionId: 'next-best-step',
    userText: 'הצעד הבא',
    synopsisOf: (result) =>
      typeof (result as { recommendation?: unknown })?.recommendation === 'string'
        ? ((result as { recommendation: string }).recommendation.slice(0, 200))
        : '',
  },
})
