import { describe, expect, it } from 'vitest'
import { isWaitingForReply, toEpochMs } from '@/lib/today/waitingReply'
import { PROMISED_WAITING_RECENCY_DAYS } from '@/lib/today/constants'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const H = 3_600_000
const D = 86_400_000

describe('isWaitingForReply', () => {
  it('inbound newer than human outbound → waiting', () => {
    expect(
      isWaitingForReply({
        lastInboundAt: NOW - 2 * H,
        lastHumanOutboundAt: NOW - 5 * H,
        nowMs: NOW,
      }),
    ).toBe(true)
  })

  it('human outbound newer than inbound → not waiting', () => {
    expect(
      isWaitingForReply({
        lastInboundAt: NOW - 5 * H,
        lastHumanOutboundAt: NOW - 2 * H,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('IRE acknowledgement (no human outbound) does NOT clear waiting', () => {
    expect(
      isWaitingForReply({
        lastInboundAt: NOW - 2 * H,
        lastHumanOutboundAt: null,
        nowMs: NOW,
      }),
    ).toBe(true)
  })

  it('no outbound → waiting', () => {
    expect(isWaitingForReply({ lastInboundAt: NOW - H, lastHumanOutboundAt: null, nowMs: NOW })).toBe(true)
  })

  it('no inbound → not waiting', () => {
    expect(isWaitingForReply({ lastInboundAt: null, lastHumanOutboundAt: NOW - H, nowMs: NOW })).toBe(false)
    expect(isWaitingForReply({ lastInboundAt: null, lastHumanOutboundAt: null, nowMs: NOW })).toBe(false)
  })

  it('equal timestamps are not waiting (inbound must be newer)', () => {
    expect(
      isWaitingForReply({ lastInboundAt: NOW - H, lastHumanOutboundAt: NOW - H, nowMs: NOW }),
    ).toBe(false)
  })

  it('inbound older than the existing recency window → not waiting', () => {
    expect(
      isWaitingForReply({
        lastInboundAt: NOW - (PROMISED_WAITING_RECENCY_DAYS + 1) * D,
        lastHumanOutboundAt: null,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('invalid / missing timestamps fail safely', () => {
    expect(isWaitingForReply({ lastInboundAt: 'not-a-date', lastHumanOutboundAt: null, nowMs: NOW })).toBe(false)
    expect(isWaitingForReply({ lastInboundAt: NOW - H, lastHumanOutboundAt: null, nowMs: Number.NaN })).toBe(false)
    expect(toEpochMs('')).toBeNull()
    expect(toEpochMs('bogus')).toBeNull()
    expect(toEpochMs(new Date('invalid'))).toBeNull()
  })
})
