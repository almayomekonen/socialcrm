'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The marketing scroll-reveal, without an animation library.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `FadeIn` used to live in `shared.tsx` and was
 * a `motion.div`. That one import made `shared.tsx` a Client Component, and
 * because six sections import `shared.tsx`, it made most of the marketing page
 * client-rendered and pulled Motion (~64 KiB transferred / ~195 KiB decoded)
 * into the initial bundle for a decorative fade.
 *
 * Splitting it out inverts that: `shared.tsx` is now a Server Component, the
 * sections that only needed `SectionHeader` are server-rendered again, and the
 * sections that do use `FadeIn` stay Server Components too — they simply render
 * this small client component and pass server-rendered `children` through it.
 * The client boundary is now this file, not the whole section tree.
 *
 * WHY NOT PURE CSS. `animation-timeline: view()` is supported in both Chromium
 * and WebKit (verified, not assumed), but it is scroll-LINKED: the animation
 * progress follows scroll position, so scrolling back up plays the reveal in
 * reverse. Motion's `viewport={{ once: true }}` never reverses — content fades
 * in once and stays. Reproducing that with a scroll timeline is not possible, so
 * a CSS-only version would have been a visible behaviour change rather than a
 * faithful port. IntersectionObserver is the smallest thing that preserves it.
 *
 * BEHAVIOUR PRESERVED EXACTLY: opacity 0 → 1, translateY 28px → 0, 600ms,
 * cubic-bezier(0.22, 1, 0.36, 1), `delay` in seconds, fires once, and the
 * `-60px` root margin (the element must be 60px inside the viewport).
 *
 * ACCESSIBILITY, IMPROVED. The Motion version applied `initial={{ opacity: 0 }}`
 * unconditionally, so a reduced-motion user still got the movement. Here,
 * reduced-motion and missing-IntersectionObserver both reveal immediately —
 * nobody is left at `opacity: 0`.
 *
 * NO CLS: only `opacity` and `transform` change, neither of which affects layout.
 */

/** Matches Motion's `viewport={{ margin: '-60px' }}`. */
const ROOT_MARGIN = '-60px'

export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  /** Seconds, as in the Motion version. */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || shown) return

    // Either of these means "show it now, don't animate": a user who asked for
    // less motion, and a browser that cannot tell us when the element appears.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        setShown(true)
        io.disconnect() // `once: true`
      },
      { rootMargin: ROOT_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
      className={`transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-7'
      } ${className}`}
    >
      {children}
    </div>
  )
}
