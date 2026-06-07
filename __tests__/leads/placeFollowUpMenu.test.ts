import { describe, it, expect } from 'vitest'
import { placeFollowUpMenu, MENU_WIDTH, MENU_MARGIN, type Rect } from '@/lib/leads/placeFollowUpMenu'

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 375, height: 667 }

// A small trigger button rect (≈ icon button) at a given top-left corner.
const triggerAt = (x: number, y: number, size = 32): Rect => ({ left: x, right: x + size, top: y, bottom: y + size })

function assertFullyVisible(pos: { top: number; left: number; width: number }, vp: { width: number; height: number }) {
  expect(pos.left).toBeGreaterThanOrEqual(MENU_MARGIN)
  expect(pos.left + pos.width).toBeLessThanOrEqual(vp.width - MENU_MARGIN)
  expect(pos.top).toBeGreaterThanOrEqual(MENU_MARGIN)
  // width never exceeds the viewport
  expect(pos.width).toBeLessThanOrEqual(vp.width - MENU_MARGIN * 2)
}

describe('placeFollowUpMenu — never clips at any corner (desktop)', () => {
  it('top-left corner → stays on-screen, opens below', () => {
    const pos = placeFollowUpMenu(triggerAt(4, 4), DESKTOP)
    assertFullyVisible(pos, DESKTOP)
    expect(pos.left).toBe(MENU_MARGIN) // clamped to left margin, not negative
    expect(pos.top).toBeGreaterThan(4) // below the trigger
  })

  it('bottom-left corner → stays on-screen, flips above', () => {
    const pos = placeFollowUpMenu(triggerAt(4, DESKTOP.height - 36), DESKTOP)
    assertFullyVisible(pos, DESKTOP)
    expect(pos.left).toBe(MENU_MARGIN)
    expect(pos.top + 248).toBeLessThanOrEqual(DESKTOP.height) // fits above
  })

  it('top-right corner → right-aligned, fully visible', () => {
    const pos = placeFollowUpMenu(triggerAt(DESKTOP.width - 36, 4), DESKTOP)
    assertFullyVisible(pos, DESKTOP)
    // right edge aligned near the trigger's right edge
    expect(pos.left + pos.width).toBeLessThanOrEqual(DESKTOP.width - MENU_MARGIN)
  })

  it('bottom-right corner → right-aligned and flipped above', () => {
    const pos = placeFollowUpMenu(triggerAt(DESKTOP.width - 36, DESKTOP.height - 36), DESKTOP)
    assertFullyVisible(pos, DESKTOP)
    expect(pos.top + 248).toBeLessThanOrEqual(DESKTOP.height)
  })
})

describe('placeFollowUpMenu — mobile viewport', () => {
  it('375px screen → full-width menu still fits, never overflows', () => {
    const pos = placeFollowUpMenu(triggerAt(MOBILE.width - 36, 100), MOBILE)
    assertFullyVisible(pos, MOBILE)
    expect(pos.width).toBe(MENU_WIDTH) // 224 fits comfortably in 375
  })

  it('mobile left edge → clamped, fully visible', () => {
    const pos = placeFollowUpMenu(triggerAt(4, 600), MOBILE)
    assertFullyVisible(pos, MOBILE)
  })

  it('very narrow screen (220px) → width shrinks to fit, never overflows', () => {
    const tiny = { width: 220, height: 500 }
    const pos = placeFollowUpMenu(triggerAt(180, 100), tiny)
    assertFullyVisible(pos, tiny)
    expect(pos.width).toBeLessThan(MENU_WIDTH) // shrunk: 220 - 16 = 204
  })
})

describe('placeFollowUpMenu — preferences when there is room', () => {
  it('plenty of room → opens below and right-aligned to the trigger', () => {
    const trigger = triggerAt(600, 200)
    const pos = placeFollowUpMenu(trigger, DESKTOP)
    expect(pos.top).toBe(trigger.bottom + 4) // below
    expect(pos.left + pos.width).toBe(trigger.right) // right edges aligned (RTL preference)
  })
})
