'use client'

import { useEffect } from 'react'

/**
 * Publishes the VISIBLE viewport's height and top offset on `<html>` as
 * `--mobile-visible-h` / `--mobile-visible-top`, for `mobile-viewport-column`
 * (main.css) to pin the workspace column to the area the user can actually see.
 *
 * ── THE DEFECT, MEASURED ────────────────────────────────────────────────────
 *
 * Reported from production: tapping the WhatsApp composer in שיחות threw the
 * thread header off the top of the screen and stranded the tab bar over a blank
 * strip. Reproduced on a real iOS 26.3 simulator against this app's own compiled
 * CSS, which is the only reason the numbers below can be trusted:
 *
 *     REST          dvh=714  vvH=714  off=0    colT=0
 *     keyboard up   dvh=714  vvH=377  off=337  colT=-337   ← the bug
 *
 * `dvh` does NOT shrink for the software keyboard. The column keeps claiming the
 * full 714px while only 377px is visible, so its bottom — composer and tab bar —
 * is below the fold, and Safari's only way to reveal the focused field is to pan
 * the layout viewport up by 337px. That pan is the broken screen.
 *
 * ── WHAT DOES NOT WORK ──────────────────────────────────────────────────────
 *
 * `interactive-widget=resizes-content` in the viewport meta: measured, IGNORED
 * by iOS 26. `dvh` stayed 714. There is no one-line fix.
 *
 * Cancelling the pan with `window.scrollTo(0, 0)`: inert. The document is locked
 * (`html:has([data-mobile-workspace]) { overflow: hidden }` in main.css), so
 * there is no document scroll to reset. A previous attempt shipped exactly that,
 * shrank the column while the pan survived, and made production visibly worse.
 *
 * ── WHAT WORKS ──────────────────────────────────────────────────────────────
 *
 * Do not fight the pan — cancel it out. Pin the column to the visual viewport:
 * take its height from `visualViewport.height` and its top from
 * `visualViewport.offsetTop`. Measured with this in place:
 *
 *     keyboard up   dvh=714  vvH=614  off=100  colT=0…2  colH=614
 *     after dismiss dvh=714  vvH=714  off=0    colT=0    colH=714
 *
 * Safari still pans (`off=100`); the column simply moves with it.
 *
 * ── WHY THESE PARTICULAR RULES ──────────────────────────────────────────────
 *
 * `height * scale`, not `height`. Pinch-zoom makes `visualViewport` report the
 * magnified rectangle — at 2× it is half as tall. Multiplying by the scale
 * converts back to layout CSS pixels, so zooming magnifies the column instead of
 * shrinking it to the loupe. The offset is forced to 0 above 1× for the same
 * reason: there the offset is the user's own panning, and following it would
 * fight them.
 *
 * `position: fixed` rather than `transform: translateY(...)` — see main.css.
 *
 * Absent `visualViewport` (older browsers, SSR) nothing is published and the
 * `100dvh` / `0` fallbacks render exactly today's behaviour. No flash, no
 * JS-dependent layout.
 *
 * SCOPE. Mounted by `MobileWorkspaceShell` and nowhere else, so desktop never
 * publishes the properties and its column resolves to `100dvh` unchanged.
 */

const H = '--mobile-visible-h'
const TOP = '--mobile-visible-top'

export function useVisibleViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement

    const publish = () => {
      root.style.setProperty(H, `${Math.round(vv.height * vv.scale)}px`)
      root.style.setProperty(TOP, `${Math.round(vv.scale > 1 ? 0 : vv.offsetTop)}px`)
    }

    publish()
    // `scroll` is what fires as Safari pans the layout viewport; `resize` is the
    // keyboard opening and closing. Both change where the visible area sits.
    vv.addEventListener('resize', publish)
    vv.addEventListener('scroll', publish)

    return () => {
      vv.removeEventListener('resize', publish)
      vv.removeEventListener('scroll', publish)
      root.style.removeProperty(H)
      root.style.removeProperty(TOP)
    }
  }, [])
}
