import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Thin chrome shared by every /admin page.
 *
 * Not a second product shell — the existing Admin is a single page with no
 * layout. Support must live inside that same experience, so this is only the
 * missing navigation strip: same measure, same RTL, same typography as
 * app/admin/page.tsx. No rails, no new design system, no billing pressure.
 */
export default function AdminChrome({
  active,
  unresolvedCount,
  children,
}: {
  active: 'home' | 'support'
  /** Unresolved Support requests — shown only when > 0 and on a clean badge. */
  unresolvedCount?: number
  children: ReactNode
}) {
  const badge =
    typeof unresolvedCount === 'number' && unresolvedCount > 0 ? (
      <span className='ms-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-800'>
        {unresolvedCount > 99 ? '99+' : unresolvedCount}
      </span>
    ) : null

  return (
    <div dir='rtl' className='mx-auto max-w-6xl px-4 py-10'>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4'>
        <Link href='/admin' className='flex items-center gap-2'>
          <img src='/media/fav.svg' alt='' className='h-6' />
          <span className='text-base font-bold tracking-tight text-gray-800'>SocialCRM · ניהול</span>
        </Link>
        <nav className='flex flex-wrap items-center gap-1 text-sm' aria-label='ניווט ניהול מערכת'>
          <AdminNavLink href='/admin' active={active === 'home'}>
            משתמשים ומנויים
          </AdminNavLink>
          <AdminNavLink href='/admin/support' active={active === 'support'}>
            תמיכה
            {badge}
          </AdminNavLink>
        </nav>
      </div>
      {children}
    </div>
  )
}

function AdminNavLink({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-lg px-3 py-1.5 transition ${
        active
          ? 'bg-gray-900 font-semibold text-white'
          : 'font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  )
}
