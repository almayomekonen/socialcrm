import {
  LEAD_INTEL_SYSTEM_PROMPT,
  type LeadSummary,
  LeadSummarySchema,
  buildLeadIntelUserMessage,
  sanitizeLeadSummary,
} from '@/lib/ai/prompts/leadIntelligence'
import { defineCachedLeadAction } from './_defineCachedLeadAction'

const TTL_SECONDS = 60 * 60 * 24 // 24h

export function leadIntelTag(leadId: number): string {
  return `ai-lead-intelligence:${leadId}`
}

export const getLeadIntelligence = defineCachedLeadAction<LeadSummary>({
  kind: 'lead.summary',
  schema: LeadSummarySchema,
  schemaName: 'LeadIntelligence',
  schemaDescription: 'סיכום קצר של ליד עבור נציג מכירות',
  system: LEAD_INTEL_SYSTEM_PROMPT,
  buildUserMessage: ({ inputs }) => buildLeadIntelUserMessage(inputs),
  sanitize: (out) => sanitizeLeadSummary(out),
  cache: {
    keyPrefix: 'lead-intelligence',
    ttlSeconds: TTL_SECONDS,
    tags: (leadId) => [leadIntelTag(leadId)],
  },
  requiresLeadName: false,
  pollutionLogPrefix: 'sanitizer',
})
