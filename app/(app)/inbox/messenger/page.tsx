import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { parseGrantedScopes } from '@/db/facebook'
import { getInAppBrowser, isMobileWorkspaceRequest } from '@/lib/device'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { messengerWindow, messengerWindowHint } from '@/lib/facebook/messenger/rules'
import { checkMessengerDelivery, pendingMessengerDeliveryChecks } from '@/lib/facebook/messenger/deliveryCheck'
import { refreshMessengerProfiles } from '@/lib/facebook/messenger/profile'
import { FACEBOOK_NOTICES, type ConnectionNotice } from '@/lib/connections/messages'
import MetaPermissionPrompt from '@/components/settings/MetaPermissionPrompt'
import { isAdmin, type Roles } from '@/types/roles'
import ConversationRefreshPoller from '@/components/summary/ConversationRefreshPoller'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import { getMessengerConversation, listMessengerConversations, listMessengerMessagePage } from '@/modules/messenger/queries'
import MessengerConversationRow from '@/modules/messenger/components/MessengerConversationRow'
import MessengerEmptyState, { type MessengerEmptyKind } from '@/modules/messenger/components/MessengerEmptyState'
import MessengerThread from '@/modules/messenger/components/MessengerThread'
import MessengerProfileAccessNotice from '@/modules/messenger/components/MessengerProfileAccessNotice'
import MessengerSearch from '@/modules/messenger/components/MessengerSearch'

/**
 * Messenger inside שיחות — a channel tab next to WhatsApp and comments, no new
 * top-level navigation (same decision as Comments, D1).
 *
 * TENANCY: agency and user come from the session; the only client inputs are
 * `c` (a conversation row id, re-checked against the agency) and `permission`
 * (a display hint from the OAuth return, never trusted for access).
 *
 * STATES, exactly one at a time: not enabled → no Page → permission missing →
 * no conversations → list (+ selected thread).
 */
export const metadata: Metadata = { title: 'Messenger' }

type SearchParams = { c?: string; permission?: string; q?: string }

const REFRESH_MS = 10_000

export default async function MessengerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')
  const agencyId = user.agencyId
  const sp = await searchParams
  const mobile = await isMobileWorkspaceRequest(agencyId)

  const shell = (content: React.ReactNode) => (
    <div className='grid gap-3 p-3 sm:p-4'>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='text-lg font-semibold text-gray-900'>הודעות Messenger</h1>
        <InboxChannelSwitch active='messenger' showMessenger />
      </header>
      {content}
    </div>
  )
  const empty = (kind: MessengerEmptyKind) => shell(<MessengerEmptyState kind={kind} compact={mobile} />)

  if (!isFacebookMessengerEnabledForAgency(agencyId)) return empty('not-enabled')

  const pages = (await db('facebook_pages')
    .where({ agency_id: agencyId })
    .select('page_id', 'granted_scopes', 'health_checked_at')) as {
    page_id: string
    granted_scopes: unknown
    health_checked_at: Date | string | null
  }[]
  if (pages.length === 0) return empty('not-connected')

  const messagingPages = pages.filter((p) => hasFeatureScopes(parseGrantedScopes(p.granted_scopes), 'messenger'))
  const messagingPageIds = new Set(messagingPages.map((p) => p.page_id))
  const inAppBrowser = await getInAppBrowser()
  // Every Messenger fix is the same admin action: the Facebook authorization, whose
  // callback refreshes the token and re-subscribes the Page (refreshConnectedPages).
  const promptFor = (notice: ConnectionNotice) => (
    <MetaPermissionPrompt
      notice={notice}
      href='/api/auth/facebook?feature=messenger'
      canAuthorize={isAdmin(user.role as Roles)}
      inAppBrowser={inAppBrowser}
    />
  )
  const permissionPrompt = promptFor(
    sp.permission === 'missing' ? FACEBOOK_NOTICES.messenger_declined : FACEBOOK_NOTICES.messenger_permission,
  )
  if (messagingPageIds.size === 0) return shell(permissionPrompt)

  const query = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : ''
  const selectedId = Number(sp.c)
  const [conversations, selected] = await Promise.all([
    listMessengerConversations(agencyId, user.id, query),
    Number.isInteger(selectedId) && selectedId > 0 ? getMessengerConversation(agencyId, user.id, selectedId) : null,
  ])
  // FILTERED-EMPTY IS NOT SYSTEM-EMPTY (ux-guidelines §11). A search that matched
  // nothing keeps the full UI and says so inside the list; only an agency with no
  // conversations at all gets the page-level onboarding state below.
  if (conversations.length === 0 && query) {
    return shell(
      <div className='overflow-hidden rounded-lg border border-gray-200 bg-white'>
        <div className='border-b border-gray-100 p-2 px-3'>
          <MessengerSearch initial={query} />
        </div>
        <p role='status' className='px-3 py-6 text-center text-sm text-gray-500'>
          לא נמצאו שיחות התואמות לחיפוש.
        </p>
      </div>,
    )
  }

  // No conversation yet: one page-level state, not an empty list beside an empty thread.
  if (conversations.length === 0) {
    // "No messages yet" promises that messages WILL arrive. A recorded grant does
    // not make that true; Meta's subscription for the Page does (deliveryCheck.ts).
    const delivery = await Promise.all(
      messagingPages.map((p) => checkMessengerDelivery(p.page_id, { rowCheckedAt: p.health_checked_at })),
    )
    after(pendingMessengerDeliveryChecks)
    // The refresh is what shows the first message without a reload, and what clears
    // the prompt once a reconnect or the hourly repair has subscribed the Page.
    const poller = <ConversationRefreshPoller intervalMs={REFRESH_MS} />
    if (delivery.includes('reconnect')) return shell(<>{poller}{promptFor(FACEBOOK_NOTICES.expired)}</>)
    if (delivery.includes('not_subscribed')) {
      return shell(<>{poller}{promptFor(FACEBOOK_NOTICES.messenger_not_subscribed)}</>)
    }
    return shell(
      <>
        {poller}
        {sp.permission === 'granted' && (
          <p role='status' className='text-sm text-green-600'>ההרשאה אושרה. הודעות Messenger חדשות יופיעו כאן.</p>
        )}
        <MessengerEmptyState kind='no-conversations' compact={mobile} />
      </>,
    )
  }
  const page = selected ? await listMessengerMessagePage(agencyId, selected.id) : { messages: [], hasMore: false }
  const messages = page.messages

  // Names and pictures come from Meta, cost a Graph call, and are never worth
  // delaying the inbox for. Refreshed AFTER the response, bounded per pass, and
  // skipped entirely for contacts Meta has already refused (profile.ts).
  after(() => refreshMessengerProfiles({ agencyId }))

  // One quiet admin-only line when Meta refuses profile access outright, so the
  // reason initials are showing is visible to the person who can act on it —
  // and invisible to everyone who cannot. Never blocks messaging.
  const profileAccessDenied = conversations.some((c) => c.profileStatus === 'denied')

  // The window is decided here, once, on the server — never re-derived in client render.
  const now = new Date()
  const replyWindow = selected ? messengerWindow(selected.lastInboundAt, now) : null
  const thread = selected ? (
    <MessengerThread
      conversation={selected}
      messages={messages}
      hasMoreMessages={page.hasMore}
      windowOpen={replyWindow!.open}
      windowHint={messengerWindowHint(replyWindow!, now)}
      canSend={messagingPageIds.has(selected.pageId)}
      permissionPrompt={permissionPrompt}
    />
  ) : null

  const profileNotice =
    profileAccessDenied && isAdmin(user.role as Roles) ? <MessengerProfileAccessNotice /> : null

  const list = (
    <nav aria-label='שיחות Messenger'>
      {conversations.map((c) => (
        <MessengerConversationRow key={c.id} item={c} selected={c.id === selected?.id} />
      ))}
    </nav>
  )

  if (mobile) {
    return (
      <div data-testid='messenger-mobile' className='flex flex-col gap-3 p-3'>
        <ConversationRefreshPoller intervalMs={REFRESH_MS} />
        <div className='[&_a]:min-h-11 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
          <InboxChannelSwitch active='messenger' showMessenger />
        </div>
        {!selected && <MessengerSearch initial={query} />}
        {profileNotice}
        {selected ? (
          <>
            <Link href='/inbox/messenger' className='inline-flex min-h-11 items-center text-sm text-primary'>
              חזרה לשיחות Messenger
            </Link>
            <div className='flex h-[70dvh] min-h-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white'>{thread}</div>
          </>
        ) : (
          <div className='overflow-hidden rounded-md border border-gray-200 bg-white'>{list}</div>
        )}
      </div>
    )
  }

  return (
    <div className='flex h-[calc(100dvh-6rem)] min-h-0 gap-3'>
      <ConversationRefreshPoller intervalMs={REFRESH_MS} />
      <aside className='flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'>
        <div className='shrink-0 space-y-2 border-b border-gray-100 p-2 px-3'>
          <InboxChannelSwitch active='messenger' showMessenger />
          <MessengerSearch initial={query} />
        </div>
        {profileNotice}
        <div className='min-h-0 flex-1 overflow-y-auto'>{list}</div>
      </aside>
      <section aria-label='שיחה' className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'>
        {thread ?? <MessengerEmptyState kind='no-selection' />}
      </section>
    </div>
  )
}
