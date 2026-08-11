import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { listPageComments } from '@/modules/facebookComments/queries'
import { COMMENT_STATUSES, type CommentStatusFilter } from '@/modules/facebookComments/types'
import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'

/**
 * Comments Inbox — lives inside the existing שיחות experience (decision D1).
 * No new top-level navigation section.
 *
 * TENANCY: `agencyId` comes from the session via `getUser()`. It is never read
 * from a querystring or any other client input; only `status` is, and it is
 * validated against a fixed vocabulary before reaching SQL.
 *
 * ROLLOUT: gated by `isFacebookCommentsEnabledForAgency` (decision D2). A
 * non-enabled agency gets a 404 — the route does not exist for them — which
 * matches the ingest gate, so nothing is stored for them either.
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
  if (!isFacebookCommentsEnabledForAgency(user.agencyId)) notFound()

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
