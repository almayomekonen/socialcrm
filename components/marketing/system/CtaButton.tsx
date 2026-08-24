import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The two marketing buttons. There is no third.
 *
 * `primary` is Lumen's signature action, ported: an INK fill (not a brand fill)
 * with a blurred accent sheen parked below the button that sweeps up on hover
 * (`.mkt-sheen`), a hairline ring, and `active:scale-98`. Lumen's premium read
 * comes from this restraint — the brand colour arrives as light passing under
 * the button rather than as a coloured rectangle. The sheen animates on the
 * block axis, so it is direction-neutral and survives RTL untouched.
 *
 * TOUCH TARGETS. Lumen's own buttons are h-9/h-10 (36/40px), which sit under
 * both Apple HIG (44pt) and Material (48dp). Ours are 44px minimum on every
 * viewport — the responsive contract is not negotiable for a reference detail.
 *
 * Renders a real `<Link>`: these are navigations, not scripted actions, so they
 * stay server-rendered, crawlable and middle-click correct. Labels name their
 * own outcome, per `ux-guidelines.md` §3.
 */

const VARIANT = {
  primary: 'mkt-sheen bg-mkt-ink text-white ring-1 ring-white/12 shadow-lg shadow-black/15',
  secondary:
    'border border-mkt-border bg-mkt-surface text-mkt-fg hover:border-[color-mix(in_oklab,var(--mkt-fg)_24%,transparent)]',
} as const

const SIZE = {
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-12 px-7 text-base',
} as const

export function CtaButton({
  href,
  children,
  variant = 'primary',
  size = 'lg',
  className,
}: {
  href: string
  children: React.ReactNode
  variant?: keyof typeof VARIANT
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-mkt-lg font-medium',
        'transition-[background-color,border-color,transform,box-shadow] duration-200 ease-mkt',
        'active:scale-[0.98]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-accent',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {children}
    </Link>
  )
}
