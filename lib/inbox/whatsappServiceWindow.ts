/**
 * WhatsApp 24-hour customer-service window.
 *
 * Meta allows free-text only after the customer writes, for 24 hours from that
 * inbound. Outbound does not reset the window. No DB column — derive from the
 * latest inbound message timestamp for THIS conversation.
 *
 * UNKNOWN fails closed: do not offer free-text.
 */

export type WhatsappServiceWindow = 'OPEN' | 'CLOSED' | 'UNKNOWN'

export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

function toMs(value: Date | string | number): number {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const ms = Date.parse(value)
  return ms
}

export function resolveWhatsappServiceWindow(
  latestInboundAt: Date | string | number | null | undefined,
  now: Date | number = Date.now(),
): WhatsappServiceWindow {
  if (latestInboundAt == null || latestInboundAt === '') return 'UNKNOWN'
  const inboundMs = toMs(latestInboundAt)
  if (!Number.isFinite(inboundMs)) return 'UNKNOWN'
  const nowMs = typeof now === 'number' ? now : now.getTime()
  if (!Number.isFinite(nowMs)) return 'UNKNOWN'
  return nowMs < inboundMs + WHATSAPP_SERVICE_WINDOW_MS ? 'OPEN' : 'CLOSED'
}

/** Latest inbound timestamp from an already-loaded thread. Ignores outbound. */
export function latestInboundTimestamp(
  messages: ReadonlyArray<{ direction: string; timestamp?: string | null }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.direction === 'inbound' && m.timestamp) return m.timestamp
  }
  return null
}
