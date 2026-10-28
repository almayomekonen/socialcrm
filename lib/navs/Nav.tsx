'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/actions/auth'
import { isAdmin, isMngr, Roles } from '@/types/roles'
import { Route } from 'next'
import { UserNAgency } from './Topbar'
import { twMerge } from 'tailwind-merge'
import Icon, { IconNames } from '@/lib/Icon'
import Loading from '@/components/ui/Loading'
import NavBadge from './NavBadge'
import { useAwarenessCount } from '@/modules/inbox/awareness/AwarenessContext'
import { NAV_RAIL_EDU, navEduForHref } from '@/lib/education/types'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'

export default function Nav({ user, inboxUnread = 0, isOwner = false, agentEnabled = false }) {
  const pathname = usePathname()
  const t = useT()
  // Live unread (delta-sync). null when disabled → fall back to the server-rendered count.
  const liveUnread = useAwarenessCount()
  const effectiveUnread = liveUnread ?? inboxUnread

  const [isLoggingOut, startLogout] = useTransition()
  const logmeout = () => startLogout(async () => { await logout() })

  const getIsActive = (pathname, href) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith('/' + href.split('/')[1])
  }

  function LogoutBtn() {
    return (
      <button
        className='flex flex-nowrap items-center w-full hover:bg-dark/50 mt-2 disabled:opacity-60'
        onClick={logmeout}
        disabled={isLoggingOut}
      >
        <span className='rounded p-2'>
          <Icon name='arrow-right-from-bracket' className='bg-white' type='sol' />
        </span>
        <p className='text-white font-semibold'>{t('shell.nav.logout')}</p>
      </button>
    )
  }

  return (
    <div className='z-999'>
      {isLoggingOut && (
        <div className='fixed inset-0 z-9999 bg-white' role='status' aria-label={t('shell.nav.loggingOut')}>
          <Loading />
        </div>
      )}
      <div popover='auto' id='navPop' className='h-full bg-dark desktop:hidden pop-bg'>
        <div>
          <div className='flex justify-start'>
            <button popoverTarget='navPop' className='hover:bg-dark/50 rounded p-2 m-2' aria-label={t('shell.nav.closeMenu')}>
              <Icon name='x' type='sol' className='bg-white' />
            </button>
          </div>
          <nav aria-label={t('shell.nav.label')} className='mt-8 p-8'>
            {getNavLinks(t, user, effectiveUnread, isOwner, agentEnabled).map((link, i) => {
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
        <nav
          aria-label={t('shell.nav.label')}
          data-edu={NAV_RAIL_EDU}
          className={'bg-dark/90 backdrop-blur-lg px-2 h-full flex items-start justify-between flex-col pb-4 '}
        >
          <div className='w-full'>
            {getNavLinks(t, user, effectiveUnread, isOwner, agentEnabled).map((link, i) => {
              if (!link) return null
              const isActive = getIsActive(pathname, link.href)
              return (
                <Link
                  key={i}
                  href={link.href}
                  data-edu={navEduForHref(link.href)}
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

function getNavLinks(t: Translator, user, inboxUnread = 0, isOwner = false, agentEnabled = false) {
  if (!user) return []
  const admin = isAdmin(user.role)
  const notOffice = user.role !== Roles.OFFICE
  return [
    notOffice && { icon: 'house', href: '/dashboard', title: t('shell.nav.today') },
    notOffice && { icon: 'image-polaroid-user', href: '/leads', title: t('shell.nav.leads') },
    notOffice && { icon: 'user-check', href: '/clients', title: t('shell.nav.clients') },
    notOffice && { icon: 'comments', href: '/inbox', title: t('shell.nav.inbox'), badge: inboxUnread },
    /*
     * The AI workspace, as a destination rather than a panel. It sits after
     * שיחות because that is where the working day actually reaches it: the rep
     * has just seen what came in and is asking what to do about it.
     *
     * `sparkles` is the mark the assistant already used in the header trigger
     * and its empty state — the same idea keeps the same icon.
     */
    // Hidden unless the rollout flag names this agency: /agent 404s otherwise,
    // and a nav item that leads to a 404 is worse than no nav item.
    notOffice && agentEnabled && { icon: 'sparkles', href: '/agent', title: t('shell.nav.agent') },
    { icon: 'dollar-sign', href: '/deals', title: t('shell.nav.deals') },
    {
      icon: 'chart-pie',
      href: '/sum_sales',
      title: t('shell.nav.performance'),
    },
    notOffice && { icon: 'list-check', href: '/tasks', title: t('shell.nav.tasks') },
    notOffice && { icon: 'calendar', href: '/calendar', title: t('shell.nav.calendar') },
    notOffice && { icon: 'gear', href: '/settings/self_edit', title: t('shell.nav.settings') },
    // Platform-owner only (allowlisted email, resolved server-side in the layout).
    isOwner && { icon: 'crown', href: '/admin', title: t('shell.nav.admin') },
  ] as { icon: IconNames; href: Route; title: string; badge?: number }[]
}
