import { DAY_MS, PROMISED_WAITING_RECENCY_DAYS } from '@/lib/today/constants'

/**
 * Shared "waiting for us" rule. Same definition Today Brief uses:
 * last inbound is newer than last HUMAN outbound, and still inside the
 * existing recency window. IRE / auto_response outbound is not passed in as
 * lastHumanOutboundAt (facts and Inbox SQL already strip it).
 */

export function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

export function isWaitingForReply(input: {
  lastInboundAt: Date | string | number | null | undefined
  lastHumanOutboundAt: Date | string | number | null | undefined
  nowMs: number
  recencyDays?: number
}): boolean {
  const inboundMs = toEpochMs(input.lastInboundAt)
  if (inboundMs == null) return false
  if (!Number.isFinite(input.nowMs)) return false

  const humanMs = toEpochMs(input.lastHumanOutboundAt)
  if (humanMs != null && inboundMs <= humanMs) return false

  const recencyDays = input.recencyDays ?? PROMISED_WAITING_RECENCY_DAYS
  return inboundMs >= input.nowMs - recencyDays * DAY_MS
}
