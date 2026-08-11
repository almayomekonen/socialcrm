import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { listSupportRequestsForAdmin } from '@/db/support/admin'
import AdminChrome from '@/components/admin/AdminChrome'
import AdminSupportTable from '@/components/admin/support/AdminSupportTable'

export const metadata: Metadata = { title: 'תמיכה · ניהול מערכת' }

async function AdminSupportContent({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  // Await searchParams INSIDE Suspense — outside would block the route under
  // Next cacheComponents (same pattern as app/admin/page.tsx).
  const { all } = await searchParams
  const showAll = all === '1'

  const user = await getUser()
  // Deny by default, and by notFound() rather than a 403 — the route's
  // existence is not revealed. Identical to app/admin/page.tsx.
  if (!user || !isPlatformOwner(user.email)) notFound()

  const unresolved = await listSupportRequestsForAdmin({ status: 'unresolved', limit: 100 })
  const rows = showAll ? await listSupportRequestsForAdmin({ limit: 100 }) : unresolved

  const awaitingUs = unresolved.filter(
    (r) => r.lastMessageAuthorKind === 'customer' && r.status !== 'resolved',
  ).length
  const openCount = unresolved.filter((r) => r.status === 'open').length

  return (
    <AdminChrome active='support' unresolvedCount={unresolved.length}>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-gray-900'>תמיכה</h1>
        <p className='mt-1 text-sm text-gray-500'>מי צריך עזרה עכשיו — לפי פעילות אחרונה.</p>
      </header>

      <div className='mb-6 grid grid-cols-2 gap-3 desktop:grid-cols-3'>
        <SummaryCard label='פתוחות' value={unresolved.length} />
        <SummaryCard label='ממתינות לתשובה' value={awaitingUs} emphasize={awaitingUs > 0} />
        <SummaryCard label='חדשות' value={openCount} />
      </div>

      <nav className='mb-4 flex gap-3 text-sm' aria-label='סינון פניות'>
        <Link
          href='/admin/support'
          className={showAll ? 'text-gray-500 hover:underline' : 'font-semibold text-gray-900'}
        >
          פתוחות
        </Link>
        <Link
          href='/admin/support?all=1'
          className={showAll ? 'font-semibold text-gray-900' : 'text-gray-500 hover:underline'}
        >
          הכול
        </Link>
      </nav>

      <AdminSupportTable rows={rows} />
    </AdminChrome>
  )
}

function SummaryCard({
  label,
  value,
  emphasize = false,
}: {
  label: string
  value: number
  emphasize?: boolean
}) {
  return (
    <div
      className={`rounded-xl border bg-white px-4 py-3 ${
        emphasize ? 'border-amber-200' : 'border-gray-200'
      }`}
    >
      <p className={`text-2xl font-extrabold ${emphasize ? 'text-amber-800' : 'text-gray-900'}`}>
        {value}
      </p>
      <p className='mt-0.5 text-xs text-gray-500'>{label}</p>
    </div>
  )
}

export default function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  return (
    <Suspense fallback={<div className='mx-auto max-w-6xl px-4 py-10 text-gray-400'>טוען…</div>}>
      <AdminSupportContent searchParams={searchParams} />
    </Suspense>
  )
}
