'use client'
import Link from 'next/link'
import { twMerge } from 'tailwind-merge'
import { usePathname } from 'next/navigation'
import Icon from '@/lib/Icon'
import NotificationBell from '@/components/notifications/NotificationBell'
import HelpTrigger from '@/components/education/HelpTrigger'
import { HEADER_EDU } from '@/lib/education/types'
import { ProNameLine } from './ProNameLabel'
import { getDisplayName } from '@/lib/users/displayName'
import { useT } from '@/lib/i18n/I18nProvider'
import { useProToastLanguage } from '@/lib/toastChrome'
import type { MessageKey } from '@/lib/i18n/translate'

type WorkspaceIdentity = { primary: MessageKey; secondary?: MessageKey }

const WORKSPACE_TITLES: Record<string, WorkspaceIdentity> = {
  '/leads': { primary: 'shell.workspace.leadsTitle', secondary: 'shell.workspace.leadsSubtitle' },
  '/clients': { primary: 'shell.workspace.clientsTitle', secondary: 'shell.workspace.clientsSubtitle' },
  '/inbox': { primary: 'shell.workspace.inboxTitle', secondary: 'shell.workspace.inboxSubtitle' },
  '/agent': { primary: 'shell.workspace.agentTitle', secondary: 'shell.workspace.agentSubtitle' },
  '/tasks': { primary: 'shell.workspace.tasksTitle', secondary: 'shell.workspace.tasksSubtitle' },
  '/sum_sales': { primary: 'shell.workspace.performanceTitle', secondary: 'shell.workspace.performanceSubtitle' },
}

function resolveWorkspaceTitle(pathname: string | null): WorkspaceIdentity | null {
  if (!pathname) return null
  if (WORKSPACE_TITLES[pathname]) return WORKSPACE_TITLES[pathname]
  for (const path of Object.keys(WORKSPACE_TITLES)) {
    if (pathname.startsWith(path + '/')) return WORKSPACE_TITLES[path]
  }
  return null
}

  export default function Topbar({
  user,
  isPro = false,
  trialDaysRemaining = null,
}: {
  user: any
  isPro?: boolean
  trialDaysRemaining?: number | null
}) {
  const pathname = usePathname()
  const t = useT()
  // The Pro toast follows the interface language on the desktop shell (lib/toastChrome.ts).
  useProToastLanguage(t)
  if (!user) return null
  const title = resolveWorkspaceTitle(pathname)
  return (
    <header data-edu={HEADER_EDU} className='w-full sticky top-0 z-888 ps-[50px]'>
      <div className='relative flex justify-between items-center h-10 wrap bg-white/90 backdrop-blur-lg border-b'>
        <button className='hover:bg-gray-100 p-2 rounded desktop:hidden' popoverTarget='navPop' aria-label={t('shell.nav.openMenu')}>
          <Icon name='bars' type='reg' />
        </button>
        {/* Inline-start cluster (visual right in RTL): notifications, help, then
            user identity. System-level workspace controls, not nav.

            The copilot trigger used to open this cluster. It is gone with the
            side panel it toggled: the assistant is now a navigation destination
            (הסוכן שלך), and a header button that opens a second, different AI
            surface is exactly the competing experience that replacement was
            meant to end. `CopilotTopbarTrigger` itself is left in the tree —
            unmounted, not deleted. */}
        <div className='hidden desktop:flex items-center gap-3'>
          <NotificationBell />
          <HelpTrigger />
          <UserNAgency user={user} isPro={isPro} trialDaysRemaining={trialDaysRemaining} />
        </div>
        <Link href='/dashboard' className='flex items-center gap-2'>
          <img src='/media/fav.svg' alt='SocialCRM' className='h-6' />
          <span className='font-bold text-lg tracking-tight text-gray-800'>SocialCRM</span>
        </Link>
        {title && (
          <span className='hidden desktop:flex absolute inset-y-0 left-1/2 -translate-x-1/2 flex-col items-center justify-center pointer-events-none select-none'>
            <span className='text-base font-semibold tracking-tight text-gray-900 leading-tight'>
              {t(title.primary)}
            </span>
            {title.secondary && (
              <span className='text-xs text-gray-500 leading-tight'>{t(title.secondary)}</span>
            )}
          </span>
        )}
      </div>
    </header>
  )
}

export function UserNAgency({
  user,
  className = null,
  isPro = false,
  trialDaysRemaining = null,
}: {
  user: any
  className?: string | null
  isPro?: boolean
  trialDaysRemaining?: number | null
}) {
  return (
    <div className={twMerge('flex', className)}>
      <Link href='/settings/self_edit' className='flex items-center gap-3' onClick={() => document.getElementById('navPop')?.hidePopover()}>
        {user?.picture ? (
          <img src={user?.picture} alt='' className='size-6 rounded-full' />
        ) : (
          <div className='bg-solid text-white size-6 text-center rounded-full'>{getDisplayName(user)[0]}</div>
        )}
        <ProNameLine user={user} isPro={isPro} trialDaysRemaining={trialDaysRemaining} />
      </Link>
    </div>
  )
}
