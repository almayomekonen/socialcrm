import { WEDDING_RSVP_ATTENDING, WEDDING_RSVP_NOT_ATTENDING } from '@/lib/weddingRsvp/config'

export type WeddingRsvpChoice = 'attending' | 'not_attending'

/**
 * Pure. Reads a raw Cloud API inbound message and returns the wedding choice
 * only for a reply-button tap carrying one of OUR two button ids. Every other
 * message — text, other interactive replies, template quick replies — is null,
 * so the hook is a no-op for the rest of the product.
 *
 * Meta shape: { type: 'interactive', interactive: { type: 'button_reply',
 *               button_reply: { id, title } } }
 */
export function getWeddingRsvpChoice(raw: unknown): WeddingRsvpChoice | null {
  const m = (raw ?? {}) as { type?: unknown; interactive?: { type?: unknown; button_reply?: { id?: unknown } } }
  if (m.type !== 'interactive' || m.interactive?.type !== 'button_reply') return null
  const id = m.interactive.button_reply?.id
  if (id === WEDDING_RSVP_ATTENDING) return 'attending'
  if (id === WEDDING_RSVP_NOT_ATTENDING) return 'not_attending'
  return null
}
