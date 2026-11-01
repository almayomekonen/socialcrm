import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAgencyUser } from '@/lib/requireUser'
import { getSupportRequestSystem } from '@/db/support/requests'
import { listSupportMessagesSystem } from '@/db/support/messages'
import { canViewSupportRequest } from '@/lib/support/permissions'
import { toThreadMessages } from '@/lib/support/presenters'
import { STATUS_COPY } from '@/lib/support/copy'
import { statusLabel, subjectText } from '@/lib/support/localizedCopy'
import { customerTextAttrs } from '@/lib/i18n/config'
import { getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'
import { StatusBadge } from '@/lib/StatusBadge'
import SupportThread from '@/components/support/SupportThread'
import SupportReplyBox from '@/components/support/SupportReplyBox'
import Loading from '@/components/ui/Loading'

/**
 * One conversation with SocialCRM support.
 *
 * The subject is the heading — there is no ticket number on this page, because
 * a customer talking to us does not need a reference code to say "the WhatsApp
 * thing". The id lives in the URL and nowhere else.
 */
async function ThreadContent({ requestId }: { requestId: number }) {
  const user = await requireAgencyUser()

  // Single scoped read. A request id from the URL can only ever address this
  // tenant's rows, and a miss is indistinguishable from a cross-tenant hit — so
  // ids are not enumerable.
  const request = await getSupportRequestSystem({ agencyId: user.agencyId, requestId })
  if (!request) notFound()
  if (!canViewSupportRequest(user as any, request)) notFound()

  const rows = await listSupportMessagesSystem({ agencyId: user.agencyId, requestId })

  // The projection drops authorUserId and filters empty bodies. A context-only
  // opening message therefore never renders as a blank card.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const messages = toThreadMessages(rows, user.id, request.requesterNameSnapshot, locale)
  const status = STATUS_COPY[request.status]

  return (
    <>
      <Link href='/support/requests' className='text-sm text-gray-500 hover:underline'>
        {t('support.center.mine')}
      </Link>

      <header className='mb-6 mt-3'>
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='text-2xl font-bold text-ink' {...customerTextAttrs(locale)}>{subjectText(request.subject, locale)}</h1>
          <StatusBadge role={status.role} label={statusLabel(request.status, locale)} />
        </div>
      </header>

      {/* PHASE 4: <SupportContextCard facts={request.context?.facts ?? []} collapsed /> */}

      <SupportThread messages={messages} locale={locale} />
      <SupportReplyBox requestId={request.id} isResolved={request.status === 'resolved'} />
    </>
  )
}

export default async function SupportRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const id = Number(requestId)
  // Rejected before any query runs.
  if (!Number.isInteger(id) || id <= 0) notFound()

  return (
    <Suspense fallback={<Loading />}>
      <ThreadContent requestId={id} />
    </Suspense>
  )
}
