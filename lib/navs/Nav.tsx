'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/actions/auth'
import { isAdmin, isMngr, Roles } from '@/types/roles'
import { Route } from 'next'
import { UserNAgency } from './Topbar'
import { twMerge } from 'tailwind-merge'
import Icon, { IconNames } from '@/lib/Icon'
import { useAwarenessCount } from '@/modules/inbox/awareness/AwarenessContext'

export default function Nav({ user, inboxUnread = 0, isOwner = false }) {
  const pathname = usePathname()
  // Live unread (delta-sync). null when disabled → fall back to the server-rendered count.
  const liveUnread = useAwarenessCount()
  const effectiveUnread = liveUnread ?? inboxUnread

  const logmeout = () => logout()

  const getIsActive = (pathname, href) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith('/' + href.split('/')[1])
  }

  function LogoutBtn() {
    return (
      <button className='flex flex-nowrap items-center w-full hover:bg-dark/50 mt-2' onClick={logmeout}>
        <span className='rounded p-2'>
          <Icon name='arrow-right-from-bracket' className='bg-white' type='sol' />
        </span>
        <p className='text-white font-semibold'>התנתקות</p>
      </button>
    )
  }

  return (
    <div className='z-999'>
      <div popover='auto' id='navPop' className='h-full bg-dark desktop:hidden pop-bg'>
        <div>
          <div className='flex justify-start'>
            <button popoverTarget='navPop' className='hover:bg-dark/50 rounded p-2 m-2' aria-label='סגירת תפריט'>
              <Icon name='x' type='sol' className='bg-white' />
            </button>
          </div>
          <nav aria-label='ניווט ראשי' className='mt-8 p-8'>
            {getNavLinks(user, effectiveUnread, isOwner).map((link, i) => {
              if (!link) return null
              const isActive = getIsActive(pathname, link.href)
              return (
                <Link
                  onClick={() => document.getElementById('navPop')?.hidePopover()}
                  key={i}
                  href={link.href}
                  className={twMerge('flex  hover:bg-dark/50 rounded mt-2', isActive ? 'bg-dark/50' : '')}
                >
                  <span className={`relative rounded p-2  ${isActive ? 'bg-white' : ''}`}>
                    <Icon name={link.icon} className={`bg-white   ${isActive ? 'bg-dark' : ''}`} type='sol' />
                    {link.badge ? <NavBadge count={link.badge} /> : null}
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

      <div
        className={`hidden desktop:block h-screen w-[50px] overflow-x-hidden fixed top-0 start-0 transition-all duration-300 ease-in-out hover:w-48 `}
      >
        <nav aria-label='ניווט ראשי' className={'bg-dark/90 backdrop-blur-lg px-2 h-full flex items-start justify-between flex-col pb-4 '}>
          <div className='w-full'>
            {getNavLinks(user, effectiveUnread, isOwner).map((link, i) => {
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
                  <span className={`relative p-2 rounded  ${isActive ? 'bg-white' : ''}`}>
                    <Icon
                      name={link.icon}
                      className={`bg-white size-[18px] rtl:scale-x-100 ${isActive ? 'bg-dark' : ''}`}
                      type='sol'
                    />
                    {link.badge ? <NavBadge count={link.badge} /> : null}
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

function NavBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className='absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white'
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function getNavLinks(user, inboxUnread = 0, isOwner = false) {
  if (!user) return []
  const admin = isAdmin(user.role)
  const notOffice = user.role !== Roles.OFFICE
  return [
    notOffice && { icon: 'house', href: '/dashboard', title: 'היום' },
    notOffice && { icon: 'image-polaroid-user', href: '/leads', title: 'לידים' },
    notOffice && { icon: 'user-check', href: '/clients', title: 'לקוחות' },
    notOffice && { icon: 'comments', href: '/inbox', title: 'שיחות', badge: inboxUnread },
    notOffice && { icon: 'bell-exclamation', href: '/recovery-alerts', title: 'התראות שחזור' },
    { icon: 'dollar-sign', href: '/deals', title: 'עסקאות' },
    {
      icon: 'chart-pie',
      href: '/sum_sales',
      title: 'ביצועים',
    },
    notOffice && { icon: 'list-check', href: '/tasks', title: 'משימות' },
    notOffice && { icon: 'calendar', href: '/calendar', title: 'פגישות' },
    notOffice && { icon: 'gear', href: '/settings/self_edit', title: 'הגדרות' },
    // Platform-owner only (allowlisted email, resolved server-side in the layout).
    isOwner && { icon: 'crown', href: '/admin', title: 'ניהול מערכת' },
  ] as { icon: IconNames; href: Route; title: string; badge?: number }[]
}
