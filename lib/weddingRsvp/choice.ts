import { RSVP_TEMPLATE_BUTTON_LABELS, WEDDING_RSVP_ATTENDING, WEDDING_RSVP_NOT_ATTENDING } from '@/lib/weddingRsvp/config'

const [TEMPLATE_ATTENDING_LABEL, TEMPLATE_NOT_ATTENDING_LABEL] = RSVP_TEMPLATE_BUTTON_LABELS

export type WeddingRsvpChoice = 'attending' | 'not_attending'

/**
 * Pure. Reads a raw Cloud API inbound message and returns the wedding choice
 * only for a tap on one of OUR RSVP buttons — the free-form reply buttons or the
 * `wedding_rsvp` template's quick replies. Every other message is null,
 * so the hook is a no-op for the rest of the product.
 *
 * Meta shape: { type: 'interactive', interactive: { type: 'button_reply',
 *               button_reply: { id, title } } }
 */
export function getWeddingRsvpChoice(raw: unknown): WeddingRsvpChoice | null {
  const m = (raw ?? {}) as {
    type?: unknown
    interactive?: { type?: unknown; button_reply?: { id?: unknown } }
    button?: { payload?: unknown }
  }
  // The approved `wedding_rsvp` TEMPLATE: a quick-reply tap arrives as
  // { type: 'button', button: { payload, text } }. We send our ids as payloads; a
  // template sent without payloads echoes the label instead, so accept both.
  if (m.type === 'button') {
    const p = m.button?.payload
    if (p === WEDDING_RSVP_ATTENDING || p === TEMPLATE_ATTENDING_LABEL) return 'attending'
    if (p === WEDDING_RSVP_NOT_ATTENDING || p === TEMPLATE_NOT_ATTENDING_LABEL) return 'not_attending'
    return null
  }
  if (m.type !== 'interactive' || m.interactive?.type !== 'button_reply') return null
  const id = m.interactive.button_reply?.id
  if (id === WEDDING_RSVP_ATTENDING) return 'attending'
  if (id === WEDDING_RSVP_NOT_ATTENDING) return 'not_attending'
  return null
}
