import { cn } from '@/lib/utils'

/**
 * Lumen's three container widths, by role. Ported exactly:
 *   default → 1112px (Lumen `.container`)
 *   wide    → 1254px (Lumen `.bigger-container`)
 *   nav     → 1334px (Lumen `.navbar-container`)
 *   prose   →  704px — ours, for long-form legal and FAQ copy where Lumen has
 *                      no equivalent and measure matters more than width.
 *
 * The gutter steps (20 → 32 → 40px) rather than sitting flat. Lumen keeps a
 * constant 22px at every viewport, which is the least considered part of its
 * spacing — verified across nine widths on the live demo.
 */
const WIDTH = {
  default: 'max-w-mkt',
  wide: 'max-w-mkt-wide',
  nav: 'max-w-mkt-nav',
  prose: 'max-w-mkt-prose',
} as const

export function Container({
  width = 'default',
  className,
  children,
}: {
  width?: keyof typeof WIDTH
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full px-5 md:px-8 lg:px-10', WIDTH[width], className)}>
      {children}
    </div>
  )
}
