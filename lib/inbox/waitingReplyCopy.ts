import { reasonFor } from '@/lib/today/labels'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
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

/**
 * Coarse duration in the interface locale ("3 שעות" / "3 hours"), counting
 * whole units downward. Counts are passed as text so Hebrew output stays exactly
 * what it was (no digit grouping); plural forms still come from the number.
 */
export function formatCoarseDuration(ms: number, locale: UiLocale = 'he'): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const t = translatorFor(locale)
  if (ms < MINUTE) return t('today.duration.underMinute')
  const minutes = Math.floor(ms / MINUTE)
  if (minutes < 60) return t('today.duration.minutes', { count: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('today.duration.hours', { count: String(hours) })
  return t('today.duration.days', { count: String(Math.floor(hours / 24)) })
}

/** Hebrew coarse duration — the original API, unchanged for its callers. */
export function formatCoarseDurationHe(ms: number): string {
  return formatCoarseDuration(ms, 'he')
}

function remainingWindowHint(
  inboundMs: number,
  nowMs: number,
  locale: UiLocale,
): { window: 'OPEN' | 'CLOSED' | 'UNKNOWN'; hint: string | null } {
  const t = translatorFor(locale)
  const window = resolveWhatsappServiceWindow(inboundMs, nowMs)
  if (window === 'UNKNOWN') return { window, hint: null }
  if (window === 'CLOSED') return { window, hint: t('today.waiting.windowClosed') }
  const remaining = inboundMs + WHATSAPP_SERVICE_WINDOW_MS - nowMs
  const duration = formatCoarseDuration(remaining, locale)
  if (!duration) return { window, hint: t('today.waiting.windowClosed') }
  return { window, hint: t('today.waiting.windowRemaining', { duration }) }
}

export function waitingReplyCopy(input: {
  lastInboundAt: Date | string | number | null | undefined
  lastHumanOutboundAt: Date | string | number | null | undefined
  nowMs: number
  channel?: string | null
  /** Interface locale for the copy. Hebrew by default (the inbox passes nothing). */
  locale?: UiLocale
}): WaitingReplyCopy | null {
  if (input.channel != null && input.channel !== 'whatsapp') return null
  if (!isWaitingForReply(input)) return null

  const inboundMs = toEpochMs(input.lastInboundAt)
  if (inboundMs == null) return null

  const locale = input.locale ?? 'he'
  const waited = formatCoarseDuration(Math.max(0, input.nowMs - inboundMs), locale)
  const { window, hint } = remainingWindowHint(inboundMs, input.nowMs, locale)
  const title = reasonFor('WAITING_REPLY', locale)

  return {
    title,
    waitingFor: waited ? translatorFor(locale)('today.waiting.for', { duration: waited }) : title,
    windowHint: hint,
    window,
  }
}

export function inboxWaitingTitle(copy: WaitingReplyCopy): string {
  const waited = copy.waitingFor.replace(/^ממתין\s+/, '')
  return waited ? `${copy.title} · ${waited}` : copy.title
}
