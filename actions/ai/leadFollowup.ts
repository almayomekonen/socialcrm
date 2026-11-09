'use server'

import {
  LEAD_FOLLOWUP_SYSTEM_PROMPT,
  type LeadFollowup,
  LeadFollowupSchema,
  buildLeadFollowupUserMessage,
  sanitizeLeadFollowup,
} from '@/lib/ai/prompts/leadFollowup'
import { defineCachedLeadAction } from './_defineCachedLeadAction'

const TTL_SECONDS = 60 * 60 * 6 // 6h

export const generateLeadFollowupMessage = defineCachedLeadAction<LeadFollowup>({
  kind: 'lead.followup',
  countsAsCopilotRequest: true,
  schema: LeadFollowupSchema,
  schemaName: 'LeadFollowupMessage',
  schemaDescription: 'הודעת המשך אחת מוכנה לשליחה ללקוח, עם נימוק תפעולי קצר',
  system: LEAD_FOLLOWUP_SYSTEM_PROMPT,
  buildUserMessage: ({ inputs, leadName }) => buildLeadFollowupUserMessage(inputs, leadName),
  sanitize: (out) => sanitizeLeadFollowup(out),
  cache: {
    keyPrefix: 'lead-followup',
    ttlSeconds: TTL_SECONDS,
    tags: (leadId) => [`ai-lead-action:followup:${leadId}`, `ai-lead-action:${leadId}`],
  },
  requiresLeadName: true,
  pollutionLogPrefix: 'sanitizer.followup',
  persist: {
    actionId: 'draft-followup-message',
    userText: 'הודעת followup',
    synopsisOf: (result) =>
      typeof (result as { message?: unknown })?.message === 'string'
        ? ((result as { message: string }).message.slice(0, 200))
        : '',
  },
})
