import { isAllowedRecipient } from '@/lib/weddingRsvp/config'
import { conversationHasRsvpRequest } from '@/lib/weddingRsvp/rsvpRequestData'

/**
 * May the RSVP flow send an automatic follow-up (head-count question / thank-you)
 * to this guest? Either the number is on the free-form route's hard allowlist, or
 * this conversation received a `wedding_rsvp` TEMPLATE request through the signed
 * Wedding Manager integration. Nobody else ever gets an automatic wedding message.
 */
export async function followUpAllowed(waId: string | null | undefined, conversationId: number): Promise<boolean> {
  if (isAllowedRecipient(waId)) return true
  if (!waId) return false
  return conversationHasRsvpRequest(conversationId)
}
