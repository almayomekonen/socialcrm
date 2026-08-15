/**
 * Pure inbound WhatsApp decision tree. No AI. No content guessing.
 *
 * FIRST: remembered user decision on the conversation row.
 *   isPersonal → stay non-lead
 *   leadId set → attach to that Lead
 * OTHERWISE:
 *   unique existing client phone match in the agency → auto-link
 *   multiple matches → do not guess (leadless)
 *   verified CTWA referral → auto-create Lead
 *   else → leadless conversation
 */

export type InboundLeadDecision =
  | { kind: 'personal' }
  | { kind: 'remembered_lead'; leadId: number }
  | { kind: 'auto_link'; leadId: number }
  | { kind: 'auto_create_ctwa' }
  | { kind: 'contact' }

export function resolveInboundLeadDecision(input: {
  isPersonal: boolean
  leadId: number | null
  matchingLeadIds: number[]
  hasCtwaReferral: boolean
}): InboundLeadDecision {
  if (input.isPersonal) return { kind: 'personal' }

  const remembered = input.leadId != null && Number.isFinite(input.leadId) && input.leadId > 0
  if (remembered) return { kind: 'remembered_lead', leadId: Number(input.leadId) }

  if (input.matchingLeadIds.length === 1) {
    return { kind: 'auto_link', leadId: input.matchingLeadIds[0] }
  }
  if (input.matchingLeadIds.length > 1) return { kind: 'contact' }

  if (input.hasCtwaReferral) return { kind: 'auto_create_ctwa' }
  return { kind: 'contact' }
}
