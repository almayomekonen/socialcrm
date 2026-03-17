'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { checkUserSuspended, logout } from '@/actions/auth'
import { useEffect, useState } from 'react'
import { isAdmin, isMngr, Roles } from '@/types/roles'
import { Route } from 'next'
import { UserNAgency } from './Topbar'
import { twMerge } from 'tailwind-merge'
import Icon, { IconNames } from '@/lib/Icon'

export default function Nav({ user }) {
  const pathname = usePathname()

  useEffect(() => {
    checkUserSuspended(user)
  })

  // מכיוון שאי אפשר להעביר את הפונקציה, אני קורא לה מכאן
  const logmeout = () => logout()

  const getIsActive = (pathname, href) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith('/' + href.split('/')[1])
  }

  function LogoutBtn() {
    return (
      <button className='flex flex-nowrap w-full hover:bg-dark/50 mt-2' onClick={logmeout}>
        <span className='rounded p-2'>
          <Icon name='arrow-right-from-bracket' className='bg-white' type='sol' />
        </span>
        <p className='text-white font-semibold'>התנתקות</p>
      </button>
    )
  }

  return (
    <div className='z-999'>
      {/* mobile nav */}
      <div popover='auto' id='navPop' className='h-full bg-dark desktop:hidden pop-bg'>
        <div>
          <div className='flex justify-start'>
            <button popoverTarget='navPop' className='hover:bg-dark/50 rounded p-2 m-2'>
              <Icon name='x' type='sol' className='bg-white' />
            </button>
          </div>
          <nav className='mt-8 p-8'>
            {getNavLinks(user).map((link, i) => {
              if (!link) return null
              const isActive = getIsActive(pathname, link.href)
              return (
                <Link
                  onClick={() => document.getElementById('navPop')?.hidePopover()}
                  key={i}
                  href={link.href}
                  className={twMerge('flex  hover:bg-dark/50 rounded mt-2', isActive ? 'bg-dark/50' : '')}
                >
                  <span className={`rounded p-2  ${isActive ? 'bg-white' : ''}`}>
                    <Icon name={link.icon} className={`bg-white   ${isActive ? 'bg-dark' : ''}`} type='sol' />
                  </span>
                  <p className='text-white text-nowrap font-semibold'>{link.title}</p>
                </Link>
              )
            })}

            <LogoutBtn />
            <UserNAgency className='text-white mt-8' user={user} />
          </nav>
        </div>
      </div>

      {/* desktop nav */}
      <div
        className={`hidden desktop:block h-[100vh] w-[50px] overflow-x-hidden fixed top-0 transition-all duration-300 ease-in-out hover:w-48 `}
      >
        <nav className={'bg-dark/90 backdrop-blur-lg px-2 h-full flex items-start justify-between flex-col pb-4 '}>
          <div className='w-full'>
            {getNavLinks(user).map((link, i) => {
              if (!link) return null
              const isActive = getIsActive(pathname, link.href)
              return (
                <Link
                  key={i}
                  href={link.href}
                  className={twMerge(
                    'flex items-center flex-nowrap my-3 gap-5 hover:bg-dark/50 rounded',
                    isActive ? 'bg-dark/50' : '',
                  )}
                >
                  <span className={`p-2 rounded  ${isActive ? 'bg-white' : ''}`}>
                    <Icon
                      name={link.icon}
                      className={`bg-white size-[18px] rtl:scale-x-100 ${isActive ? 'bg-dark' : ''}`}
                      type='sol'
                    />
                  </span>
                  <p className='text-white text-nowrap font-semibold'>{link.title}</p>
                </Link>
              )
            })}
          </div>

          <LogoutBtn />
        </nav>
      </div>
    </div>
  )
}

function getNavLinks(user) {
  if (!user) return []
  const admin = isAdmin(user.role)
  const notOffice = user.role !== Roles.OFFICE
  return [
    { icon: 'dollar-sign', href: '/', title: 'עסקאות' },
    {
      icon: 'chart-pie',
      href: '/sum_sales',
      title: 'דוחות',
    },
    { icon: 'users', href: '/clients', title: 'לקוחות' },
    notOffice && { icon: 'image-polaroid-user', href: '/leads', title: 'לידים' },
    notOffice && { icon: 'list-check', href: '/tasks', title: 'משימות' },
    notOffice && { icon: 'trophy-star', href: '/promotion', title: 'קמפיינים' },
    admin && { icon: 'file', href: '/files', title: 'קבצים' },
    notOffice && { icon: 'gear', href: '/settings/self_edit', title: 'הגדרות' },
  ] as { icon: IconNames; href: Route; title: string }[]
}
