import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { listCommentReplies, listPageComments } from '@/modules/facebookComments/queries'
import { parseGrantedScopes } from '@/db/facebook'
import {
  hasFeatureScopes,
  isFacebookCommentRepliesEnabledForAgency,
  isFacebookMessengerEnabledForAgency,
} from '@/lib/facebook/permissions'
import { threadRootId } from '@/lib/facebook/comments/thread'
import MetaPermissionPrompt from '@/components/settings/MetaPermissionPrompt'
import { isAdmin, type Roles } from '@/types/roles'
import { FACEBOOK_NOTICES } from '@/lib/connections/messages'
import { COMMENT_STATUSES, type CommentStatusFilter } from '@/modules/facebookComments/types'
import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import { getInAppBrowser, isMobileWorkspaceRequest } from '@/lib/device'
import CommentsInboxMobile from '@/modules/facebookComments/mobile/CommentsInboxMobile'

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

type SearchParams = { status?: string; permission?: string }

export default async function FacebookCommentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')

  const enabled = isFacebookCommentsEnabledForAgency(user.agencyId)
  const showMessenger = isFacebookMessengerEnabledForAgency(user.agencyId)
  const mobile = await isMobileWorkspaceRequest(user.agencyId)

  // Dark launch: show the shell + honest empty state. Do not query or pretend
  // rows exist — ingest remains blocked until the agency is allowlisted.
  if (!enabled) {
    if (mobile) {
      return <CommentsInboxMobile emptyKind='not-enabled' comments={[]} awaitingText={false} showMessenger={showMessenger} />
    }
    return (
      <div className='grid gap-3 p-3 sm:p-4'>
        <header className='flex flex-wrap items-center justify-between gap-2'>
          <h1 className='text-lg font-semibold text-gray-900'>תגובות מפייסבוק</h1>
          <InboxChannelSwitch active='facebook' showMessenger={showMessenger} />
        </header>
        <CommentsEmptyState kind='not-enabled' />
      </div>
    )
  }

  const sp = await searchParams
  const status: CommentStatusFilter = COMMENT_STATUSES.includes(sp.status as CommentStatusFilter)
    ? (sp.status as CommentStatusFilter)
    : 'open'

  // Every Page this agency owns (an agency may hold several), with the grant
  // Meta recorded for each. Replying is offered per Page, never assumed.
  const pages = (await db('facebook_pages')
    .where({ agency_id: user.agencyId })
    .select('page_id', 'granted_scopes')) as { page_id: string; granted_scopes: unknown }[]
  const connection = pages[0] ?? null
  const page = connection ? await listPageComments(user.agencyId, { status }) : { items: [], nextCursor: null }

  // Replies are their own rollout: without it no reply form and no permission prompt appear.
  const repliesEnabled = isFacebookCommentRepliesEnabledForAgency(user.agencyId)
  const replyablePageIds = repliesEnabled
    ? pages.filter((p) => hasFeatureScopes(parseGrantedScopes(p.granted_scopes), 'comment_replies')).map((p) => p.page_id)
    : []
  const replies = await listCommentReplies(
    user.agencyId,
    page.items.map((c) => ({ pageId: c.pageId, commentId: threadRootId(c) })),
  )

  // One prompt, above the list, only when there are comments to reply to and a
  // Page that cannot. Returning from a declined consent says so plainly.
  const replyNotice =
    !repliesEnabled || page.items.length === 0 || replyablePageIds.length === pages.length
      ? null
      : sp.permission === 'missing'
        ? FACEBOOK_NOTICES.comment_replies_declined
        : FACEBOOK_NOTICES.comment_replies_permission
  const replyPrompt = replyNotice ? (
    <MetaPermissionPrompt
      notice={replyNotice}
      href='/api/auth/facebook?feature=comment_replies'
      canAuthorize={isAdmin(user.role as Roles)}
      inAppBrowser={await getInAppBrowser()}
    />
  ) : sp.permission === 'granted' && replyablePageIds.length > 0 ? (
    // Returned from Facebook with the permission granted: say so once (ux-guidelines §8).
    <p role='status' className='text-sm text-green-600'>ההרשאה אושרה. אפשר להשיב לתגובות מכאן.</p>
  ) : null

  // Exactly one page-level state at a time (ux-guidelines §11). "awaiting-text"
  // is not an empty state — comments exist, so the notice sits ABOVE the list
  // to explain the blanks rather than replacing the data.
  const awaitingText = page.items.length > 0 && page.items.every((c) => !c.messageAvailable)

  if (mobile) {
    const emptyKind = !connection ? 'not-connected' : page.items.length === 0 ? 'no-comments' : null
    return (
      <CommentsInboxMobile
        emptyKind={emptyKind}
        comments={connection ? page.items : []}
        awaitingText={awaitingText}
        replies={replies}
        replyablePageIds={replyablePageIds}
        replyPrompt={replyPrompt}
        showMessenger={showMessenger}
      />
    )
  }

  return (
    <div className='grid gap-3 p-3 sm:p-4'>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-lg font-semibold text-gray-900'>תגובות מפייסבוק</h1>
        <InboxChannelSwitch active='facebook' showMessenger={showMessenger} />
      </header>

      {!connection && <CommentsEmptyState kind='not-connected' />}

      {connection && page.items.length === 0 && <CommentsEmptyState kind='no-comments' />}

      {connection && page.items.length > 0 && (
        <>
          {awaitingText && <CommentsEmptyState kind='awaiting-text' />}
          {replyPrompt}
          <CommentsList comments={page.items} replies={replies} replyablePageIds={replyablePageIds} />
        </>
      )}
    </div>
  )
}
