'use client'

import { useEffect } from 'react'

/**
 * Publishes the height of the VISIBLE viewport on `<html>` as
 * `--mobile-visible-h`, for the `h-visible-viewport` utility to size the mobile
 * workspace column from.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * Reported from production on a real iPhone: tapping the WhatsApp composer in
 * שיחות pushed the whole screen up. The thread header went off the top, the tab
 * bar ended up stranded with blank below it, and the layout stayed wrong after
 * the keyboard was dismissed.
 *
 * WHY THE EARLIER ROUNDS DID NOT COVER IT. fa802aa5 / 89da1623 / c12a7ea7 /
 * c65b80cf fixed the DOCUMENT-scroll half of the mobile thread: `body`'s
 * computed `overflow-y: auto` made the document a second scroller, the nested
 * `100dvh` overflowed the visual viewport, and pointer capture in `useLongPress`
 * ate the pan gesture. Those are fixed and stay fixed — the document is locked
 * (`html:has([data-mobile-workspace])` in main.css) and the message list is the
 * only scroller.
 *
 * What none of them touched is the UNIT. The workspace column is still `100dvh`,
 * and `dvh` is a LAYOUT-viewport unit: iOS Safari does not shrink the layout
 * viewport for the software keyboard. It shrinks the VISUAL viewport and pans
 * the layout viewport upward to reveal the focused field. So the column goes on
 * claiming the full screen height while barely half of it is visible, the
 * composer sits below the fold, and panning it into view is the only move Safari
 * has left — which is precisely the report. Locking the document does not
 * prevent that pan; it has nothing to do with document scroll.
 *
 * THE FIX. Size the column to the area that is actually visible. Then the
 * composer is already above the keyboard, Safari has nothing left to reveal, and
 * there is no pan to survive.
 *
 * ── WHY THESE PARTICULAR RULES ──────────────────────────────────────────────
 *
 * `height * scale`, not `height`. When the user pinch-zooms, `visualViewport`
 * reports the magnified rectangle — at 2× it is half as tall. Multiplying by the
 * scale converts it back to layout CSS pixels, so zooming in magnifies the
 * workspace instead of shrinking it to the loupe.
 *
 * The pan is undone only while the page is unzoomed. Above 1× the offset is the
 * user's own panning, and yanking it back to the top would fight them.
 *
 * `visualViewport` is absent on old browsers and during SSR. Nothing is
 * published then, and the utility's `100dvh` fallback owns the height exactly as
 * it does today — no flash, no JS-dependent layout.
 *
 * SCOPE. Mounted by `MobileWorkspaceShell` and nowhere else. The desktop shell
 * never renders it, never sets the property, and keeps resolving to `100dvh`.
 */

const VAR = '--mobile-visible-h'

export function useVisibleViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement

    const publish = () => {
      root.style.setProperty(VAR, `${Math.round(vv.height * vv.scale)}px`)
    }

    /**
     * Undo a pan Safari performed to reveal a focused field. In normal use the
     * offset is 0 and this does nothing at all; it only fires in the exact
     * situation the bug report describes.
     */
    const unpan = () => {
      if (vv.scale > 1) return
      if (vv.offsetTop === 0 && window.scrollY === 0) return
      window.scrollTo(0, 0)
    }

    const onResize = () => {
      publish()
      unpan()
    }

    publish()
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', unpan)

    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', unpan)
      root.style.removeProperty(VAR)
    }
  }, [])
}
