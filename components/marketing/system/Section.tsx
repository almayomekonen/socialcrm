import { cn } from '@/lib/utils'

/**
 * A marketing section — the only place a ground is chosen.
 *
 * THE RULE: `light` for narrative and long-form SEO copy, `dark` for product
 * moments. Two grounds, no more. The old site carried eight ad-hoc near-blacks
 * flipped without a rule, and three legal pages that inherited a dark ground
 * with dark text (1.03:1 measured). A ground here always carries its matching
 * foreground, so that class of defect cannot recur.
 *
 * Vertical rhythm is Lumen's `.section-padding` (py-17 / md:py-24 / lg:py-28),
 * ported verbatim as `.mkt-section`.
 *
 * Server Component. Sections render on the server and delegate to small client
 * leaves (`Reveal`) only where interaction genuinely requires it.
 */

export type Ground = 'light' | 'dark'

export function Section({
  ground,
  flush,
  className,
  children,
  id,
  'aria-labelledby': ariaLabelledby,
}: {
  ground: Ground
  /** Section paints its own padding (hero, full-bleed product). */
  flush?: boolean
  className?: string
  children: React.ReactNode
  id?: string
  'aria-labelledby'?: string
}) {
  return (
    <section
      id={id}
      aria-labelledby={ariaLabelledby}
      className={cn(
        ground === 'dark' ? 'mkt-ground-dark' : 'mkt-ground-light',
        !flush && 'mkt-section',
        className,
      )}
    >
      {children}
    </section>
  )
}
