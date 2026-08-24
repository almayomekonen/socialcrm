'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The site's one scroll-reveal — Lumen's entrance language (rise + de-blur)
 * without Lumen's runtime.
 *
 * Lumen drives entrances with `motion/react` springs. Reproducing that would
 * pull Motion (~64 KiB transferred / ~195 KiB decoded) into the marketing
 * bundle for a decorative fade. The visual result here is the same; the cost is
 * a class toggle. The animation itself lives in CSS (`.mkt-reveal`).
 *
 * Sections stay Server Components and pass server-rendered `children` through
 * this leaf, so the client boundary is this file rather than the section tree.
 *
 * REDUCED MOTION AND MISSING-IO BOTH REVEAL IMMEDIATELY — nobody is ever left
 * at `opacity: 0` because a preference was set or an API was absent.
 */

/** Element must be this far inside the viewport before it reveals. */
const ROOT_MARGIN = '-64px'

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  /** Seconds. Keep a stagger under ~0.25s total; longer reads as a slideshow. */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || shown) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        setShown(true)
        io.disconnect()
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
      className={cn('mkt-reveal', shown && 'mkt-reveal-in', className)}
    >
      {children}
    </div>
  )
}
