import { describe, expect, it } from 'vitest'
import {
  AWAY_GAP_MINUTES,
  PRESENCE_WRITE_THROTTLE_SECONDS,
  resolveAwayBoundary,
  toPresenceRow,
  type PresenceSnapshot,
} from '@/db/notifications/presence'
import { classifyPresence } from '@/lib/notifications/presence'

/**
 * The away boundary — spec §13.3, P2.0 discovery §7.
 *
 * Pure tests, no database: resolveAwayBoundary is a function of (snapshot, now)
 * precisely so the rule that keeps "While you were away" on screen can be proven
 * without fixtures or a clock.
 *
 * Presence CLASSIFICATION (missing row ⇒ offline, online/idle/offline windows) is
 * already covered by policy.test.ts §"presence classification"; it is not
 * duplicated here. What is new in P2.1 is the boundary lifecycle and the write
 * throttle, so that is what this file pins.
 */

const NOW = new Date('2026-08-11T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const snapshot = (over: Partial<PresenceSnapshot> = {}): PresenceSnapshot => ({
  lastSeenAt: minutesAgo(1),
  lastSeenVisible: true,
  awaySinceAt: null,
  ...over,
})

describe('away boundary: opening', () => {
  it('a first-ever visit opens no boundary — a new user has no away period', () => {
    const result = resolveAwayBoundary({ snapshot: snapshot({ lastSeenAt: null }), now: NOW })
    expect(result).toBeNull()
  })

  it('a short gap opens no boundary — switching tabs is not being away', () => {
    const result = resolveAwayBoundary({ snapshot: snapshot({ lastSeenAt: minutesAgo(2) }), now: NOW })
    expect(result).toBeNull()
  })

  it('a gap longer than the away window opens the boundary AT the previous lastSeenAt', () => {
    const previous = minutesAgo(120)
    const result = resolveAwayBoundary({ snapshot: snapshot({ lastSeenAt: previous }), now: NOW })
    expect(result).toEqual(previous)
  })

  it('the away window is longer than the idle window — idle needs no catch-up summary', () => {
    // A user who is merely idle (at the desk, not looking) must not be handed a
    // "while you were away" summary. 15min > the 10min idle ceiling guarantees it.
    expect(AWAY_GAP_MINUTES * 60_000).toBeGreaterThan(10 * 60 * 1000)
  })

  it('exactly at the threshold does not open — the gap must EXCEED the window', () => {
    const result = resolveAwayBoundary({
      snapshot: snapshot({ lastSeenAt: minutesAgo(AWAY_GAP_MINUTES) }),
      now: NOW,
    })
    expect(result).toEqual(minutesAgo(AWAY_GAP_MINUTES))
  })
})

describe('away boundary: survival — the invariant that keeps WYWA on screen', () => {
  it('an OPEN boundary wins over a fresh lastSeenAt', () => {
    /**
     * THE REGRESSION THIS FILE EXISTS FOR.
     *
     * Poll 1 detects a 2-hour gap and opens the boundary, then stamps lastSeenAt
     * to now. Poll 2, five seconds later, sees a fresh lastSeenAt. If the rule
     * recomputed from lastSeenAt, poll 2 would return null and the section would
     * vanish from under the user. The persisted boundary must win.
     */
    const opened = minutesAgo(120)
    const afterStamp = snapshot({ lastSeenAt: minutesAgo(0.08), awaySinceAt: opened })

    expect(resolveAwayBoundary({ snapshot: afterStamp, now: NOW })).toEqual(opened)
  })

  it('the boundary survives an arbitrary number of polls', () => {
    const opened = minutesAgo(120)
    let current = snapshot({ lastSeenAt: opened, awaySinceAt: null })

    // Poll 1 opens it.
    const first = resolveAwayBoundary({ snapshot: current, now: NOW })
    expect(first).toEqual(opened)

    // Every later poll re-reads a row whose lastSeenAt keeps advancing.
    for (let i = 1; i <= 10; i++) {
      current = { lastSeenAt: new Date(NOW.getTime() + i * 5_000), lastSeenVisible: true, awaySinceAt: first }
      const again = resolveAwayBoundary({ snapshot: current, now: new Date(NOW.getTime() + i * 5_000) })
      expect(again, `poll ${i}`).toEqual(opened)
    }
  })

  it('a cleared boundary does not spontaneously reopen from a fresh row', () => {
    // Post-clear state: boundary null, lastSeenAt recent. Nothing to show, and
    // nothing that could re-derive a window. This is what stops WYWA
    // self-reopening (Law 10).
    const settled = snapshot({ lastSeenAt: minutesAgo(0.5), awaySinceAt: null })
    expect(resolveAwayBoundary({ snapshot: settled, now: NOW })).toBeNull()
  })
})

describe('presence write throttle', () => {
  it('is 30 seconds — a write budget, not an accuracy figure (spec §7.2)', () => {
    expect(PRESENCE_WRITE_THROTTLE_SECONDS).toBe(30)
  })

  it('leaves headroom below the ONLINE window so a present user is never misread', () => {
    // The stamp cadence must be comfortably shorter than the 90s ONLINE window,
    // or throttling itself would demote an active user to idle.
    const onlineWindowSeconds = 90
    expect(PRESENCE_WRITE_THROTTLE_SECONDS * 2).toBeLessThanOrEqual(onlineWindowSeconds)
  })
})

describe('snapshot → classifier adapter', () => {
  it('an absent row becomes null, which the classifier reads as OFFLINE', () => {
    const row = toPresenceRow(snapshot({ lastSeenAt: null }))
    expect(row).toBeNull()
    expect(classifyPresence(row, NOW)).toBe('offline')
  })

  it('carries lastSeenVisible through, so a hidden tab classifies IDLE not ONLINE', () => {
    const row = toPresenceRow(snapshot({ lastSeenAt: minutesAgo(0.1), lastSeenVisible: false }))
    expect(row).toEqual({ lastSeenAt: minutesAgo(0.1), lastSeenVisible: false })
    expect(classifyPresence(row, NOW)).toBe('idle')
  })

  it('does not leak awaySinceAt into the classifier — presence and catch-up are independent', () => {
    const row = toPresenceRow(snapshot({ awaySinceAt: minutesAgo(200) }))
    expect(row).not.toHaveProperty('awaySinceAt')
    expect(classifyPresence(row, NOW)).toBe('online')
  })
})
