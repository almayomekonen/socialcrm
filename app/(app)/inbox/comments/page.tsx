import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { listPageComments } from '@/modules/facebookComments/queries'
import { COMMENT_STATUSES, type CommentStatusFilter } from '@/modules/facebookComments/types'
import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'

/**
 * Comments Inbox — lives inside the existing שיחות experience (decision D1).
 * No new top-level navigation section.
 *
 * TENANCY: `agencyId` comes from the session via `getUser()`. It is never read
 * from a querystring or any other client input; only `status` is, and it is
 * validated against a fixed vocabulary before reaching SQL.
 *
 * ROLLOUT: ingest and convert stay gated by `isFacebookCommentsEnabledForAgency`.
 * The UI itself stays reachable so the empty/preview states can be inspected
 * without enabling production comment ingestion.
 */
export const metadata: Metadata = { title: 'תגובות מפייסבוק' }

type SearchParams = { status?: string }

export default async function FacebookCommentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')

  const enabled = isFacebookCommentsEnabledForAgency(user.agencyId)

  // Dark launch: show the shell + honest empty state. Do not query or pretend
  // rows exist — ingest remains blocked until the agency is allowlisted.
  if (!enabled) {
    return (
      <div className='grid gap-3 p-3 sm:p-4'>
        <header className='flex flex-wrap items-center justify-between gap-2'>
          <h1 className='text-lg font-semibold text-gray-900'>תגובות מפייסבוק</h1>
          <InboxChannelSwitch active='facebook' />
        </header>
        <CommentsEmptyState kind='not-enabled' />
      </div>
    )
  }

  const sp = await searchParams
  const status: CommentStatusFilter = COMMENT_STATUSES.includes(sp.status as CommentStatusFilter)
    ? (sp.status as CommentStatusFilter)
    : 'open'

  const connection = await db('facebook_pages').where({ agency_id: user.agencyId }).first()
  const page = connection ? await listPageComments(user.agencyId, { status }) : { items: [], nextCursor: null }

  // Exactly one page-level state at a time (ux-guidelines §11). "awaiting-text"
  // is not an empty state — comments exist, so the notice sits ABOVE the list
  // to explain the blanks rather than replacing the data.
  const awaitingText = page.items.length > 0 && page.items.every((c) => !c.messageAvailable)

  return (
    <div className='grid gap-3 p-3 sm:p-4'>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-lg font-semibold text-gray-900'>תגובות מפייסבוק</h1>
        <InboxChannelSwitch active='facebook' />
      </header>

      {!connection && <CommentsEmptyState kind='not-connected' />}

      {connection && page.items.length === 0 && <CommentsEmptyState kind='no-comments' />}

      {connection && page.items.length > 0 && (
        <>
          {awaitingText && <CommentsEmptyState kind='awaiting-text' />}
          <CommentsList comments={page.items} />
        </>
      )}
    </div>
  )
}
