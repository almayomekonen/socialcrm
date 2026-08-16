import { reasonFor } from '@/lib/today/labels'
import { isWaitingForReply, toEpochMs } from '@/lib/today/waitingReply'
import {
  resolveWhatsappServiceWindow,
  WHATSAPP_SERVICE_WINDOW_MS,
} from '@/lib/inbox/whatsappServiceWindow'

/**
 * Stable Hebrew copy for a waiting WhatsApp conversation.
 * Durations are coarse (minutes / hours / days) — never a live countdown.
 */

export type WaitingReplyCopy = {
  title: string
  waitingFor: string
  windowHint: string | null
  window: 'OPEN' | 'CLOSED' | 'UNKNOWN'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatCoarseDurationHe(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < MINUTE) return 'פחות מדקה'
  const minutes = Math.floor(ms / MINUTE)
  if (minutes === 1) return 'דקה'
  if (minutes < 60) return `${minutes} דקות`
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return 'שעה'
  if (hours < 24) return `${hours} שעות`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'יום'
  return `${days} ימים`
}

function remainingWindowHint(inboundMs: number, nowMs: number): { window: 'OPEN' | 'CLOSED' | 'UNKNOWN'; hint: string | null } {
  const window = resolveWhatsappServiceWindow(inboundMs, nowMs)
  if (window === 'UNKNOWN') return { window, hint: null }
  if (window === 'CLOSED') return { window, hint: 'חלון WhatsApp נסגר' }
  const remaining = inboundMs + WHATSAPP_SERVICE_WINDOW_MS - nowMs
  const duration = formatCoarseDurationHe(remaining)
  if (!duration) return { window, hint: 'חלון WhatsApp נסגר' }
  return { window, hint: `נותרו ${duration} בחלון WhatsApp` }
}

export function waitingReplyCopy(input: {
  lastInboundAt: Date | string | number | null | undefined
  lastHumanOutboundAt: Date | string | number | null | undefined
  nowMs: number
  channel?: string | null
}): WaitingReplyCopy | null {
  if (input.channel != null && input.channel !== 'whatsapp') return null
  if (!isWaitingForReply(input)) return null

  const inboundMs = toEpochMs(input.lastInboundAt)
  if (inboundMs == null) return null

  const waited = formatCoarseDurationHe(Math.max(0, input.nowMs - inboundMs))
  const { window, hint } = remainingWindowHint(inboundMs, input.nowMs)
  const title = reasonFor('WAITING_REPLY')

  return {
    title,
    waitingFor: waited ? `ממתין ${waited}` : title,
    windowHint: hint,
    window,
  }
}

export function inboxWaitingTitle(copy: WaitingReplyCopy): string {
  const waited = copy.waitingFor.replace(/^ממתין\s+/, '')
  return waited ? `${copy.title} · ${waited}` : copy.title
}
