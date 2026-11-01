import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getUser } from '@/db/auth'
import { isPlatformOwner } from '@/lib/auth/platformOwner'
import { getSupportRequestForAdmin, listSupportRequestsForAdmin } from '@/db/support/admin'
import { listSupportMessagesSystem } from '@/db/support/messages'
import AdminChrome from '@/components/admin/AdminChrome'
import AdminSupportDetail from '@/components/admin/support/AdminSupportDetail'
import AdminReplyBox from '@/components/admin/support/AdminReplyBox'
import AdminStatusControls from '@/components/admin/support/AdminStatusControls'

export const metadata: Metadata = { title: 'פנייה · תמיכה · ניהול מערכת' }

async function DetailContent({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  // Await params INSIDE Suspense so uncached reads don't block the route shell.
  const { requestId } = await params
  const id = Number(requestId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const user = await getUser()
  if (!user || !isPlatformOwner(user.email)) notFound()

  const request = await getSupportRequestForAdmin(id)
  if (!request) notFound()

  // agencyId comes from the ROW we just read, never from the URL — the same
  // derive-from-the-verified-parent rule the message writer uses. No unscoped
  // message read exists, and none should be added.
  const [messages, unresolved] = await Promise.all([
    listSupportMessagesSystem({
      agencyId: request.agencyId,
      requestId: request.id,
    }),
    listSupportRequestsForAdmin({ status: 'unresolved', limit: 100 }),
  ])

  return (
    <AdminChrome active='support' unresolvedCount={unresolved.length}>
      <Link href='/admin/support' className='text-sm text-gray-500 hover:underline'>
        חזרה לפניות
      </Link>
      <div className='mt-4 max-w-3xl'>
        <AdminSupportDetail request={request} messages={messages} />
        <AdminReplyBox requestId={request.id} />
        <AdminStatusControls requestId={request.id} current={request.status} />
      </div>
    </AdminChrome>
  )
}

export default function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  return (
    <Suspense fallback={<div className='mx-auto max-w-6xl px-4 py-10 text-gray-400'>טוען…</div>}>
      <DetailContent params={params} />
    </Suspense>
  )
}
