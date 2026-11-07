/** Provenance of an inbound message timestamp. Pure. */
import { describe, expect, it } from 'vitest'
import { timestampSource } from '@/lib/whatsapp/platform/timestampSource'

const RECEIVED = Date.parse('2026-11-07T12:30:00Z')
const sec = (ms: number) => Math.floor(ms / 1000)

describe('timestampSource', () => {
  it('no Meta timestamp → the server-time fallback', () => {
    expect(timestampSource(null, RECEIVED)).toBe('server')
  })

  it.each([
    ['received now', sec(RECEIVED), 'meta'],
    ['sent 3 days earlier (a redelivery)', sec(RECEIVED - 3 * 86_400_000), 'meta'],
    ['exactly 7 days earlier', sec(RECEIVED - 7 * 86_400_000), 'meta'],
    ['exactly 5 minutes ahead', sec(RECEIVED + 5 * 60_000), 'meta'],
    ['more than 7 days earlier', sec(RECEIVED - 7 * 86_400_000) - 1, null],
    ['more than 5 minutes ahead', sec(RECEIVED + 5 * 60_000) + 1, null],
  ])('%s → %s', (_label, s, expected) => {
    expect(timestampSource(s, RECEIVED)).toBe(expected)
  })
})
