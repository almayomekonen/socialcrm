import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { listSupportRequestsSystem } from '@/db/support/requests'
import { visibilityScopeFor } from '@/lib/support/permissions'
import { toRequestSummaries } from '@/lib/support/presenters'
import SupportRequestList from '@/components/support/SupportRequestList'
import { Btn } from '@/lib/btns/Btn'
import Loading from '@/components/ui/Loading'

export const metadata: Metadata = { title: 'הפניות שלי' }

async function RequestsContent() {
  const user = await requireAgencyUser()

  // Scope is decided HERE from the session's role and passed in; the domain
  // primitive never derives visibility for itself.
  const rows = await listSupportRequestsSystem({
    agencyId: user.agencyId,
    viewerUserId: user.id,
    scope: visibilityScopeFor(user as any),
    limit: 50,
  })
  const requests = toRequestSummaries(rows, user.id)

  return (
    <>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-ink'>הפניות שלי</h1>
        <p className='mt-1.5 text-sm text-gray-500'>השיחות שלך עם צוות SocialCRM.</p>
      </header>

      {requests.length > 0 ? (
        <SupportRequestList requests={requests} />
      ) : (
        <div className='rounded-2xl border border-gray-200 p-8 text-center'>
          <p className='font-medium text-ink'>עדיין לא פנית אלינו</p>
          <p className='mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500'>
            אם משהו לא עובד כמו שצריך, ספרו לנו ואנחנו נטפל בזה.
          </p>
          <Btn href={'/support/new?kind=problem' as any} lbl='יש לי תקלה' className='mx-auto mt-5' />
        </div>
      )}
    </>
  )
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RequestsContent />
    </Suspense>
  )
}
