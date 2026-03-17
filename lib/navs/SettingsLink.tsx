'use client'
import { usePathname } from 'next/navigation'
import React from 'react'
import { IconNames } from '@/lib/Icon'
import { Btn } from '../btns/Btn'
import { twMerge } from 'tailwind-merge'

export default function SettingsLink({ href, icon, title }: { href: string; icon: IconNames; title: string }) {
  const pathname = usePathname()
  const isActive = pathname === href
  const link = { pathname: href }

  return (
    <Btn
      lbl={title}
      className={twMerge('w-full justify-start', isActive ? 'bg-gray-100 pointer-events-none text-solid' : '')}
      href={link as any}
      icon={icon}
      title={title}
      iconClassName={isActive ? 'bg-solid' : ''}
      variant='ghost'
    />
  )
}
