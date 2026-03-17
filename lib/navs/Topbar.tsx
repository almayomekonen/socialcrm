'use client'
import { MapRoles } from '@/types/roles'
import Link from 'next/link'
import { twMerge } from 'tailwind-merge'
import Icon from '@/lib/Icon'

  export default function Topbar({ user }) {
  if (!user) return null
  return (
    <div className='w-full'>
      <div className='flex justify-between items-center h-10 wrap bg-white/90 backdrop-blur-lg  top-0 left-0 z-888  border-b'>
        <button className='hover:bg-gray-100 p-2 rounded desktop:hidden' popoverTarget='navPop'>
          <Icon name='bars' type='reg' />
        </button>
        <div className='hidden desktop:block'>
          <UserNAgency user={user} />
        </div>
        <Link href='/' className='flex items-center gap-2'>
          <img src='/media/fav.svg' alt='SocialCRM' className='h-6' />
          <span className='font-bold text-lg tracking-tight text-gray-800'>SocialCRM</span>
        </Link>
      </div>
    </div>
  )
}

export function UserNAgency({ user, className = null }) {
  return (
    <div className={twMerge('flex', className)}>
      <Link href='/settings/self_edit' className='flex gap-3' onClick={() => document.getElementById('navPop')?.hidePopover()}>
        {user?.picture ? (
          <img src={user?.picture} alt='' className='size-6 rounded-full' />
        ) : (
          <div className='bg-solid text-white size-6 text-center rounded-full'>{user?.name?.[0]}</div>
        )}
        <p className='text-sm'>{`${user?.name} - ${MapRoles[user?.role]}`}</p>
      </Link>
    </div>
  )
}
