'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import Icon, { IconNames } from '@/lib/Icon'

type BaseProps = {
  icon?: IconNames
  tileClass?: string 
  tile?: ReactNode 
  title: string
  description: string
  badge?: string
  badgeClass?: string
  recommended?: boolean
  disabled?: boolean
  className?: string
  'data-add-lead'?: string
}

/**
 * A card either navigates (`href`) or acts (`onClick`) — but a navigating card
 * may ALSO carry an `onClick` side effect, which is why this is no longer an
 * exclusive union. The first-run screen uses it to record connect intent as the
 * card is clicked, so leaving the screen is not misreported as a deferral.
 *
 * The handler never cancels navigation; when `href` is set the link still
 * navigates exactly as before.
 */
type Props = BaseProps & { href?: string; onClick?: () => void }

export default function OnboardingActionCard({
  icon,
  tileClass,
  tile,
  title,
  description,
  badge,
  badgeClass = 'bg-neutral-bg text-neutral-text',
  recommended = false,
  disabled = false,
  className = '',
  href,
  onClick,
  'data-add-lead': addLead,
}: Props) {
  const base =
    'group flex items-center gap-5 rounded-2xl border bg-white p-6 text-start transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const tone = disabled
    ? 'border-gray-200 opacity-60'
    : recommended
      ? 'border-primary/40 bg-primary-tint/50 ring-1 ring-primary/10 hover:ring-primary/25 hover:shadow-sm'
      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
  const cls = `${base} ${tone} ${className}`

  const inner = (
    <>
      {tile ?? (
        <div className={`flex size-16 shrink-0 items-center justify-center rounded-2xl ${tileClass}`}>
          {icon && <Icon name={icon} type='sol' className='size-8 bg-white' />}
        </div>
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 className='text-base font-semibold leading-tight text-ink'>{title}</h3>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}>{badge}</span>
          )}
        </div>
        {/*
          `truncate` clipped every description on the first-run screen to one
          line. On the recommended import card that cut "קובץ אקסל, או פשוט
          הדביקו מספרי טלפון" at "מספ…", hiding the word טלפון — i.e. the single
          detail that tells a phone user the paste path exists at all. Found in
          browser QA at 1440px; it is not a narrow-viewport edge case.

          `line-clamp-2` keeps the height bounded so cards in a grid stay even,
          while letting a real sentence render.
        */}
        <p className='mt-1 line-clamp-2 text-sm font-medium text-primary-text'>{description}</p>
      </div>
    </>
  )

  const addLeadAttr = addLead != null ? { 'data-add-lead': addLead } : undefined

  if (disabled) return <div className={cls}>{inner}</div>
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick} {...addLeadAttr}>
        {inner}
      </Link>
    )
  return (
    <button type='button' onClick={onClick} className={`${cls} w-full`} {...addLeadAttr}>
      {inner}
    </button>
  )
}
