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

type Props = BaseProps &
  ({ href?: string; onClick?: undefined } | { onClick?: () => void; href?: undefined })

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
        <p className='mt-1 truncate text-sm font-medium text-primary-text'>{description}</p>
      </div>
    </>
  )

  const addLeadAttr = addLead != null ? { 'data-add-lead': addLead } : undefined

  if (disabled) return <div className={cls}>{inner}</div>
  if (href)
    return (
      <Link href={href} className={cls} {...addLeadAttr}>
        {inner}
      </Link>
    )
  return (
    <button type='button' onClick={onClick} className={`${cls} w-full`} {...addLeadAttr}>
      {inner}
    </button>
  )
}
