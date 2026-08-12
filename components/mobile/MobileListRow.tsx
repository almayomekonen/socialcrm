'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'

/**
 * The mobile list row — one tappable record in a scrolling list.
 *
 * This is the primitive the Phase 3 lead card is built from, kept generic so the
 * follow-up list, the notification list and any later list share one row rhythm
 * instead of three near-identical ones.
 *
 * WHY NOT `OnboardingActionCard`: that component is the canonical *action tile*
 * (`architecture-rules.md` §10) — a large icon tile, title and description, sized
 * for a first-run grid of 2–4 choices. A list row is a different job: dense,
 * repeated hundreds of times, with metadata and trailing state. Reusing the tile
 * here would mean overriding nearly every class it sets, which is a fork wearing
 * a reuse costume. Spacing and radius are matched to it so the two read as one
 * family.
 *
 * The whole row is the tap target (min-h-16 = 64px). Inline actions are
 * deliberately NOT nested inside it — a button inside a link is a broken tap
 * target on touch and invalid nesting for assistive tech. Row actions belong in
 * a bottom sheet opened from `trailing`, or on the detail screen.
 */
export default function MobileListRow({
  href,
  onClick,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  badges,
  unread = false,
  className = '',
}: {
  href?: Route
  onClick?: () => void
  /** Avatar or icon tile. */
  leading?: ReactNode
  title: string
  /** One line under the title — phone, source, whatever decides the next action. */
  subtitle?: string
  /** Right-aligned micro-copy: last activity, due date. */
  meta?: string
  /** Trailing affordance. Defaults to a chevron when the row navigates. */
  trailing?: ReactNode
  /** Status/source chips. Keep to two — a third wraps and breaks the rhythm. */
  badges?: ReactNode
  unread?: boolean
  className?: string
}) {
  const inner = (
    <>
      {leading && <div className='shrink-0'>{leading}</div>}

      <div className='min-w-0 flex-1'>
        <div className='flex items-baseline gap-2'>
          <span className={`truncate text-[15px] leading-tight text-ink ${unread ? 'font-bold' : 'font-semibold'}`}>
            {title}
          </span>
          {meta && (
            <span className='ms-auto shrink-0 text-[11px] tabular-nums leading-tight text-gray-400'>{meta}</span>
          )}
        </div>

        {subtitle && <p className='mt-0.5 truncate text-[13px] leading-tight text-gray-500'>{subtitle}</p>}
        {badges && <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>{badges}</div>}
      </div>

      <div className='flex shrink-0 items-center'>
        {trailing ?? (
          (href || onClick) && (
            /* Chevron points LEFT in RTL — forward travel is toward the left
               edge. Purely decorative: the row's own text is its name. */
            <Icon name='angle-left' type='sol' className='size-4 bg-gray-300' />
          )
        )}
      </div>
    </>
  )

  const cls = `flex w-full min-h-16 items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-gray-50 active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
    unread ? 'bg-primary-tint/40' : ''
  } ${className}`

  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    )
  }

  return (
    <button type='button' onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

/**
 * Container for a run of rows. Owns the hairlines so individual rows don't each
 * carry a border and double up at the seams.
 */
export function MobileList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-gray-100 ${className}`}>{children}</div>
}
