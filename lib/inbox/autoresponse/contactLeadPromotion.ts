/**
 * Contact → Lead promotion is separate from IRE eligibility.
 * Pure: current inbound text only. No extra LLM.
 * Social prefixes must not suppress a real business question on the same turn.
 */
import { detectOptOut } from './qualify'
import { inboundHasMeaningfulSalesIntent, isLowInformationInbound } from './gptEligibility'

export function shouldPromoteContactToLead(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (detectOptOut(t)) return false
  if (isLowInformationInbound(t)) return false
  return inboundHasMeaningfulSalesIntent(t)
}
