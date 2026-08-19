/**
 * Deterministic no-response warning/close policy. Pure — no I/O, no OpenAI.
 * Sales Stop Policy stays in conversationControl.ts; this is a lifecycle add-on.
 */
import { conversationCloser } from './conversationControl'

export const NO_RESPONSE_WARNING_TEXT = 'ראיתי שאין מענה כבר 10 דקות. האם תרצה לסגור את השיחה?'
export const NO_RESPONSE_CLOSED_TEXT = 'השיחה נסגרה עקב חוסר מענה.'
export const NO_RESPONSE_WARNING_DELAY_SECONDS = 600
export const NO_RESPONSE_CLOSE_DELAY_SECONDS = 180
export const NO_RESPONSE_CLOSED_STATE_REASON = 'no_response'

export type NoResponseJobReason = 'no_response_warning' | 'no_response_close'
export type NoResponseKind = NoResponseJobReason

export type QuietHours = { tz?: string; startHour?: number; endHour?: number }

export type NoResponseSkipReason =
  | 'customer_replied'
  | 'already_closed'
  | 'already_escalated'
  | 'human_active'
  | 'opted_out'
  | 'duplicate_warning'
  | 'duplicate_close'
  | 'stale_trigger'
  | 'conversation_missing'

export type NoResponseDecision =
  | { action: 'send' }
  | { action: 'skip'; reason: NoResponseSkipReason }
  | { action: 'defer_quiet_hours' }

export type NoResponseFacts = {
  phase: 'warning' | 'close'
  aiState: string | null
  lastDirection: string | null
  lastText: string
  lastKind: string
  lastSequence: number
  maxInboundSequence: number
  triggerSequence: number
  withinQuietHours: boolean
  conversationMissing: boolean
}

export function metadataKind(metadata: unknown): string {
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return (m as { kind?: string } | null)?.kind ?? ''
  } catch {
    return ''
  }
}

export function isNoResponseSystemKind(kind: string): boolean {
  return kind === 'no_response_warning' || kind === 'no_response_close'
}

export function withinQuietHours(qh: QuietHours | undefined, now: Date): boolean {
  if (qh?.startHour == null || qh?.endHour == null) return false
  const tz = qh.tz || 'Asia/Jerusalem'
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now))
  return qh.startHour <= qh.endHour ? hour >= qh.startHour && hour < qh.endHour : hour >= qh.startHour || hour < qh.endHour
}

/** First instant after the current quiet window. Minute walk stays DST-safe. */
export function nextAllowedAfterQuietHours(qh: QuietHours | undefined, now: Date): Date {
  if (!withinQuietHours(qh, now)) return now
  const cursor = new Date(now.getTime())
  for (let i = 0; i < 24 * 60; i++) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
    if (!withinQuietHours(qh, cursor)) return cursor
  }
  return new Date(now.getTime() + 60 * 60 * 1000)
}

export function isTerminalOutboundText(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (t === NO_RESPONSE_CLOSED_TEXT) return true
  if (t === conversationCloser('he') || t === conversationCloser('en')) return true
  return false
}

export function isNoResponseWarningMessage(text: string, kind: string): boolean {
  return kind === 'no_response_warning' || (text ?? '').trim() === NO_RESPONSE_WARNING_TEXT
}

export function isNoResponseCloseMessage(text: string, kind: string): boolean {
  return kind === 'no_response_close' || (text ?? '').trim() === NO_RESPONSE_CLOSED_TEXT
}

export function decideNoResponseJob(f: NoResponseFacts): NoResponseDecision {
  if (f.conversationMissing) return { action: 'skip', reason: 'conversation_missing' }
  if (f.aiState === 'closed') return { action: 'skip', reason: 'already_closed' }
  if (f.aiState === 'escalated') return { action: 'skip', reason: 'already_escalated' }
  if (f.aiState === 'human_active') return { action: 'skip', reason: 'human_active' }
  if (f.aiState === 'opted_out') return { action: 'skip', reason: 'opted_out' }
  if (f.lastDirection === 'inbound' || f.maxInboundSequence > f.triggerSequence) {
    return { action: 'skip', reason: 'customer_replied' }
  }
  if (!Number.isFinite(f.triggerSequence) || f.triggerSequence <= 0) {
    return { action: 'skip', reason: 'stale_trigger' }
  }
  // Warning must still be sitting on the CONTINUE outbound. Close jobs keep that
  // same CONTINUE triggerSequence as the wait anchor, so lastSequence (the warning)
  // is allowed to differ.
  if (f.phase === 'warning' && f.lastSequence !== f.triggerSequence) {
    return { action: 'skip', reason: 'stale_trigger' }
  }

  if (f.phase === 'warning') {
    if (f.lastKind === 'no_response_warning' || f.lastText.trim() === NO_RESPONSE_WARNING_TEXT) {
      return { action: 'skip', reason: 'duplicate_warning' }
    }
    if (isTerminalOutboundText(f.lastText) || isNoResponseSystemKind(f.lastKind)) {
      return { action: 'skip', reason: 'stale_trigger' }
    }
  } else {
    if (f.lastKind === 'no_response_close' || f.lastText.trim() === NO_RESPONSE_CLOSED_TEXT) {
      return { action: 'skip', reason: 'duplicate_close' }
    }
    const waitingOnWarning =
      f.lastKind === 'no_response_warning' || f.lastText.trim() === NO_RESPONSE_WARNING_TEXT
    if (!waitingOnWarning) return { action: 'skip', reason: 'stale_trigger' }
  }

  if (f.withinQuietHours) return { action: 'defer_quiet_hours' }
  return { action: 'send' }
}
