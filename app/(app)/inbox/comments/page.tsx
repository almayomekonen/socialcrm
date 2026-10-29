import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { after } from 'next/server'
import { countOpenComments } from '@/modules/facebookComments/queries'
import { loadCommentsFeedPage, type CommentsFeedPage } from '@/modules/facebookComments/feed'
import { refreshCommentContext } from '@/lib/facebook/comments/enrich'
import { parseGrantedScopes } from '@/db/facebook'
import {
  hasFeatureScopes,
  isFacebookCommentRepliesEnabledForAgency,
  isFacebookMessengerEnabledForAgency,
} from '@/lib/facebook/permissions'
import MetaPermissionPrompt from '@/components/settings/MetaPermissionPrompt'
import { isAdmin, type Roles } from '@/types/roles'
import { metaInboxNotice } from '@/lib/connections/metaNoticeCopy'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { CommentStatusFilter } from '@/modules/facebookComments/types'
import CommentsList from '@/modules/facebookComments/components/CommentsList'
import CommentsEmptyState from '@/modules/facebookComments/components/CommentsEmptyState'
import CommentsStatusFilter, { PAGE_STATUS_FILTERS } from '@/modules/facebookComments/components/CommentsStatusFilter'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import { countUnreadMessengerConversations } from '@/modules/messenger/queries'
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
 *
 * LANGUAGE: the page follows the interface language — desktop and the phone
 * branch (`CommentsInboxMobile`) alike — resolved once here and passed down as
 * `locale`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('inbox.comments.page.title') }
}

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
  // A rep reading comments still needs to know a Messenger customer wrote.
  const messengerUnread = showMessenger
    ? await countUnreadMessengerConversations(user.agencyId, user.id).catch(() => 0)
    : 0
  const mobile = await isMobileWorkspaceRequest(user.agencyId)
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)

  // Dark launch: show the shell + honest empty state. Do not query or pretend
  // rows exist — ingest remains blocked until the agency is allowlisted.
  if (!enabled) {
    if (mobile) {
      return <CommentsInboxMobile emptyKind='not-enabled' comments={[]} showMessenger={showMessenger} locale={locale} />
    }
    return (
      <div className='grid gap-3 p-3 sm:p-4' {...regionAttrs(locale)}>
        <header className='flex flex-wrap items-center justify-between gap-2'>
          <h1 className='text-lg font-semibold text-gray-900'>{t('inbox.comments.page.title')}</h1>
          <InboxChannelSwitch active='facebook' showMessenger={showMessenger} messengerUnread={messengerUnread} locale={locale} />
        </header>
        <CommentsEmptyState kind='not-enabled' locale={locale} />
      </div>
    )
  }

  const sp = await searchParams
  // Default "הכל", like the WhatsApp inbox: a comment turned into a ליד stays in
  // view with its link instead of vanishing from an open-only list. Only the
  // filters this page offers are accepted; anything else is "הכל".
  const status: CommentStatusFilter = PAGE_STATUS_FILTERS.includes(sp.status as CommentStatusFilter)
    ? (sp.status as CommentStatusFilter)
    : 'all'

  // Every Page this agency owns (an agency may hold several), with the grant
  // Meta recorded for each. Replying is offered per Page, never assumed.
  const pages = (await db('facebook_pages')
    .where({ agency_id: user.agencyId })
    .select('page_id', 'granted_scopes')) as { page_id: string; granted_scopes: unknown }[]
  const connection = pages[0] ?? null
  const agencyId: number = user.agencyId
  const [page, openCount] = connection
    ? await Promise.all([loadCommentsFeedPage(agencyId, { status }), countOpenComments(agencyId).catch(() => null)])
    : [{ items: [], replies: [], posts: [], nextCursor: null } as CommentsFeedPage, null]
  const { replies } = page

  // Who wrote it and what post it was on: read from Graph AFTER the response,
  // bounded, only for the comments this render shows (lib/facebook/comments/enrich.ts).
  const shownIds = page.items.map((c) => c.id)
  if (shownIds.length > 0) after(() => refreshCommentContext({ agencyId, commentRowIds: shownIds }))

  // No page-level "reconnect for text" notice: production shows comment text
  // arriving on the webhook for Pages whose recorded grant lacks
  // pages_read_user_content (2026-10-05 audit), so the grant does not predict
  // text. A comment without text says so on its own card.

  // Replies are their own rollout: without it no reply form and no permission prompt appear.
  const repliesEnabled = isFacebookCommentRepliesEnabledForAgency(user.agencyId)
  const replyablePageIds = repliesEnabled
    ? pages.filter((p) => hasFeatureScopes(parseGrantedScopes(p.granted_scopes), 'comment_replies')).map((p) => p.page_id)
    : []

  // One prompt, above the list, only when there are comments to reply to and a
  // Page that cannot. Returning from a declined consent says so plainly.
  const replyNotice =
    !repliesEnabled || page.items.length === 0 || replyablePageIds.length === pages.length
      ? null
      : metaInboxNotice(sp.permission === 'missing' ? 'comment_replies_declined' : 'comment_replies_permission', locale)
  const replyPrompt = replyNotice ? (
    <MetaPermissionPrompt
      notice={replyNotice}
      href='/api/auth/facebook?feature=comment_replies'
      canAuthorize={isAdmin(user.role as Roles)}
      inAppBrowser={await getInAppBrowser()}
      locale={locale}
    />
  ) : sp.permission === 'granted' && replyablePageIds.length > 0 ? (
    // Returned from Facebook with the permission granted: say so once (ux-guidelines §8).
    <p role='status' className='text-sm text-green-600'>{t('inbox.comments.page.granted')}</p>
  ) : null

  // Exactly one page-level state at a time (ux-guidelines §11).
  // Zero rows under a narrowing filter is filtered-empty, not "no comments yet".
  const noRowsKind = status === 'open' ? 'no-open' : status === 'converted' ? 'no-converted' : 'no-comments'
  // System-empty (no comments at all) shows no filter; filtered-empty keeps it (ux-guidelines §11).
  const statusFilter =
    status !== 'all' || page.items.length > 0 ? <CommentsStatusFilter active={status} openCount={openCount} locale={locale} /> : null

  if (mobile) {
    const emptyKind = !connection ? 'not-connected' : page.items.length === 0 ? noRowsKind : null
    return (
      <CommentsInboxMobile
        emptyKind={emptyKind}
        statusFilter={connection && statusFilter}
        leavesViewOnConvert={status === 'open'}
        comments={connection ? page.items : []}
        replies={replies}
        posts={page.posts}
        replyablePageIds={replyablePageIds}
        replyPrompt={replyPrompt}
        showMessenger={showMessenger}
        nextCursor={page.nextCursor}
        status={status}
        locale={locale}
      />
    )
  }

  return (
    <div className='grid gap-3 p-3 sm:p-4' {...regionAttrs(locale)}>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-lg font-semibold text-gray-900'>{t('inbox.comments.page.title')}</h1>
        <InboxChannelSwitch active='facebook' showMessenger={showMessenger} messengerUnread={messengerUnread} locale={locale} />
      </header>

      {!connection && <CommentsEmptyState kind='not-connected' locale={locale} />}

      {connection && statusFilter}

      {connection && page.items.length === 0 && <CommentsEmptyState kind={noRowsKind} locale={locale} />}

      {connection && page.items.length > 0 && (
        <>
          {replyPrompt}
          <CommentsList
            comments={page.items}
            replies={replies}
            posts={page.posts}
            replyablePageIds={replyablePageIds}
            leavesViewOnConvert={status === 'open'}
            nextCursor={page.nextCursor}
            status={status}
            locale={locale}
          />
        </>
      )}
    </div>
  )
}
