'use client'

import { motion, useReducedMotion } from 'motion/react'

/**
 * Text with a highlight sweeping through it — for a wait that is really happening.
 *
 * IT IS A LOADING STATE, NOT DECORATION. The sweep says "still working" for a
 * process whose duration nobody can predict, which is the one thing motion is
 * genuinely better at than words. It must therefore only ever wrap a label that
 * is TRUE while it animates; looping it over stale text would be the fake
 * progress the experience guidelines forbid.
 *
 * COLOURS COME FROM THE SURFACE, not from this file. The original version
 * hardcoded `#404040 → #fff`, which reads as muddy grey on anything that is not
 * neutral dark — and the agent canvas is navy. Both stops are custom properties
 * so a caller can tune them per surface, defaulting to the resting and emphasis
 * text colours a dark surface already uses.
 *
 * IT SWEEPS RIGHT-TO-LEFT because the product is Hebrew. A highlight travelling
 * against the reading direction reads as something scrubbing backwards over the
 * words rather than moving through them.
 *
 * A SPAN, NOT AN `h1`. The original rendered a heading, which inside a chat
 * thread or a button would put a spurious entry in the document outline and
 * mislead a screen reader. The live-region and label semantics belong to
 * whatever is reporting the wait; this element only paints.
 */
export function ShiningText({
  text,
  className = '',
  /** Resting colour of the text. */
  base = 'rgba(255,255,255,0.55)',
  /** The colour of the highlight passing through it. */
  highlight = '#ffffff',
  /** One full pass, in seconds. */
  duration = 2,
}: {
  text: string
  className?: string
  base?: string
  highlight?: string
  duration?: number
}) {
  /**
   * `prefers-reduced-motion` is honoured by not animating at all rather than by
   * animating less: a perpetual loop is exactly the kind of motion the setting
   * exists to switch off. The text stays fully legible in its emphasis colour,
   * so nothing is lost but the movement.
   */
  const reduced = useReducedMotion()

  if (reduced) {
    return (
      <span className={className} style={{ color: highlight }}>
        {text}
      </span>
    )
  }

  return (
    <motion.span
      /**
       * `forced-colors` undoes the gradient. In Windows high-contrast mode the
       * background is replaced by the system's own, and text painted THROUGH a
       * background would come out invisible — so the paint is dropped and the
       * system colour takes over.
       */
      className={`bg-clip-text text-transparent forced-colors:bg-none forced-colors:text-[CanvasText] ${className}`}
      style={{
        backgroundImage: `linear-gradient(110deg, ${base}, 35%, ${highlight}, 50%, ${base}, 75%, ${base})`,
        backgroundSize: '200% 100%',
      }}
      // Right-to-left, following the reading direction of the product.
      initial={{ backgroundPosition: '-200% 0' }}
      animate={{ backgroundPosition: '200% 0' }}
      transition={{ repeat: Infinity, duration, ease: 'linear' }}
    >
      {text}
    </motion.span>
  )
}
