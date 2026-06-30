'use client'
import { RoleLabels } from '@/types/roles'
import Link from 'next/link'
import { twMerge } from 'tailwind-merge'
import { usePathname } from 'next/navigation'
import Icon from '@/lib/Icon'
import CopilotTopbarTrigger from '@/components/copilot/CopilotTopbarTrigger'

type WorkspaceIdentity = { primary: string; secondary?: string }

const WORKSPACE_TITLES: Record<string, WorkspaceIdentity> = {
  '/leads': { primary: 'לידים', secondary: 'ניהול ומעקב לידים' },
  '/clients': { primary: 'לקוחות', secondary: 'ניהול קשרי לקוחות' },
  '/inbox': { primary: 'שיחות', secondary: 'תיבת שיחות' },
  '/tasks': { primary: 'משימות', secondary: 'המשימות שלך להיום' },
  '/sum_sales': { primary: 'ביצועים', secondary: 'תובנות ומדדים' },
}

function resolveWorkspaceTitle(pathname: string | null): WorkspaceIdentity | null {
  if (!pathname) return null
  if (WORKSPACE_TITLES[pathname]) return WORKSPACE_TITLES[pathname]
  for (const path of Object.keys(WORKSPACE_TITLES)) {
    if (pathname.startsWith(path + '/')) return WORKSPACE_TITLES[path]
  }
  return null
}

  export default function Topbar({ user }) {
  const pathname = usePathname()
  if (!user) return null
  const title = resolveWorkspaceTitle(pathname)
  return (
    <div className='w-full sticky top-0 z-888 ps-[50px]'>
      <div className='relative flex justify-between items-center h-10 wrap bg-white/90 backdrop-blur-lg border-b'>
        <button className='hover:bg-gray-100 p-2 rounded desktop:hidden' popoverTarget='navPop' aria-label='פתיחת תפריט'>
          <Icon name='bars' type='reg' />
        </button>
        {/* Inline-start cluster (visual right in RTL): copilot trigger at the
            outermost corner, then user identity. Treats the copilot as a
            system-level workspace control, not a navigation item. */}
        <div className='hidden desktop:flex items-center gap-3'>
          <CopilotTopbarTrigger />
          <UserNAgency user={user} />
        </div>
        <Link href='/dashboard' className='flex items-center gap-2'>
          <img src='/media/fav.svg' alt='SocialCRM' className='h-6' />
          <span className='font-bold text-lg tracking-tight text-gray-800'>SocialCRM</span>
        </Link>
        {title && (
          <span className='hidden desktop:flex absolute inset-y-0 left-1/2 -translate-x-1/2 flex-col items-center justify-center pointer-events-none select-none'>
            <span className='text-base font-semibold tracking-tight text-gray-900 leading-tight'>
              {title.primary}
            </span>
            {title.secondary && (
              <span className='text-xs text-gray-500 leading-tight'>{title.secondary}</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

export function UserNAgency({ user, className = null }) {
  return (
    <div className={twMerge('flex', className)}>
      <Link href='/settings/self_edit' className='flex items-center gap-3' onClick={() => document.getElementById('navPop')?.hidePopover()}>
        {user?.picture ? (
          <img src={user?.picture} alt='' className='size-6 rounded-full' />
        ) : (
          <div className='bg-solid text-white size-6 text-center rounded-full'>{user?.name?.[0]}</div>
        )}
        <p className='text-sm'>{`${user?.name || user?.gglName}${user?.role ? ` - ${RoleLabels[user.role] || user.role}` : ''}`}</p>
      </Link>
    </div>
  )
}
