'use client'

import { useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { DEVICE_OVERRIDE_PARAM, withDeviceOverride } from '@/lib/deviceOverride'
import type { DeviceClass } from '@/lib/device'

/**
 * Keeps `?device=phone` attached while you navigate around locally.
 *
 * THE PROBLEM. The override is stateless by design — it lives in the URL and
 * nowhere else (no cookie, deliberately). Any client navigation that builds its
 * own href therefore drops it. When it drops mid-session the server renders the
 * NEXT page for the real device while the already-mounted shell stays as it was,
 * which measured as a mobile shell wrapped around the desktop leads table.
 *
 * ── Why the interception happens in TWO places, and not in `history` ─────────
 *
 * Next 16 has two distinct client navigation paths, and neither covers the other:
 *
 *   `<Link>`                 `client/app-dir/link.js` calls `dispatchNavigateAction()`
 *                            DIRECTLY. It never reads the router off context, so a
 *                            context wrapper cannot see it. → capture-phase click.
 *
 *   `router.push/replace`    `next/navigation`'s `useRouter()` reads
 *                            `AppRouterContext`. A click listener cannot see it,
 *                            because there needn't be a click at all. → context wrapper.
 *
 * `history.pushState` is deliberately NOT used as the interception point, even
 * though it would catch both. Two reasons, both verified in the Next source:
 *   1. `client/components/app-router.js` commits the URL inside a `useEffect`
 *      that runs AFTER the navigation state — and therefore after the RSC fetch.
 *      Rewriting there would fix the address bar while the server had already
 *      rendered the wrong entity: the right URL over the wrong page, which is
 *      worse than today's bug.
 *   2. Next already patches `pushState`/`replaceState` itself (same file) to
 *      observe external history changes, with an internal re-entrancy guard.
 *      Patching on top of that is fragile by construction.
 *
 * Back and forward need no handling at all: they replay history entries that
 * were written with the parameter already attached.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * All URL rules live in `withDeviceOverride` — external, protocol-relative,
 * `mailto:`, `tel:`, `#fragment` and already-overridden URLs are returned
 * untouched, so the parameter can never leak off-origin.
 *
 * This does NOT make DevTools Responsive mode become a phone. Nothing here
 * classifies a device; `getDeviceClass()` remains the sole authority and the
 * real User-Agent still decides when no override is present. This only keeps an
 * override you typed yourself from evaporating on the next tap.
 *
 * PRODUCTION RENDERS NOTHING. The layout passes `device={null}` outside
 * development (`getActiveDeviceOverride()` is null there), and this returns
 * `children` unwrapped — no provider, no listener, no behaviour change.
 */
export default function DeviceOverrideLinks({
  device,
  children,
}: {
  device: DeviceClass | null
  children: ReactNode
}) {
  const router = useRouter()
  const appRouter = useContext(AppRouterContext)

  /* ---- path 1: <Link> ---------------------------------------------------
   * Capture phase, so this runs before Next's own click handling. Next's
   * `<Link>` onClick starts with `if (e.defaultPrevented) return`, so calling
   * preventDefault here hands the navigation over WITHOUT `stopPropagation()` —
   * every other click handler on the page still fires normally. */
  useEffect(() => {
    if (!device) return

    function onClickCapture(e: MouseEvent) {
      if (e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!anchor) return

      if (anchor.hasAttribute('download')) return
      const anchorTarget = anchor.getAttribute('target')
      if (anchorTarget && anchorTarget !== '_self') return

      const href = anchor.getAttribute('href')
      if (!href) return

      const next = withDeviceOverride(href, device)
      // Unchanged means the URL is one this must not touch (external, mailto:,
      // tel:, #fragment) or already carries an explicit choice.
      if (next === href) return

      e.preventDefault()
      router.push(next)
    }

    document.addEventListener('click', onClickCapture, true)
    return () => document.removeEventListener('click', onClickCapture, true)
  }, [device, router])

  /* ---- path 2: router.push / router.replace ------------------------------
   * A wrapped router placed back on the same context `useRouter()` reads from,
   * so every existing `router.push(...)` call site is covered without any of
   * them knowing an override exists. `prefetch`, `back`, `forward` and `refresh`
   * pass through untouched. */
  const wrapped = useMemo(() => {
    if (!device || !appRouter) return appRouter
    return {
      ...appRouter,
      push: (href: string, options?: Parameters<typeof appRouter.push>[1]) =>
        appRouter.push(withDeviceOverride(href, device), options),
      replace: (href: string, options?: Parameters<typeof appRouter.replace>[1]) =>
        appRouter.replace(withDeviceOverride(href, device), options),
    }
  }, [appRouter, device])

  if (!device || !wrapped) return <>{children}</>
  return <AppRouterContext.Provider value={wrapped}>{children}</AppRouterContext.Provider>
}

/** Exported for the regression suite. */
export const __test = { DEVICE_OVERRIDE_PARAM }
