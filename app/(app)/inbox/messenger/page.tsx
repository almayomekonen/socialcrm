import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { parseGrantedScopes } from '@/db/facebook'
import { getInAppBrowser, isMobileWorkspaceRequest } from '@/lib/device'
import { hasFeatureScopes, isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { messengerWindow, messengerWindowHint } from '@/lib/facebook/messenger/rules'
import { FACEBOOK_NOTICES } from '@/lib/connections/messages'
import MetaPermissionPrompt from '@/components/settings/MetaPermissionPrompt'
import { isAdmin, type Roles } from '@/types/roles'
import ConversationRefreshPoller from '@/components/summary/ConversationRefreshPoller'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import { getMessengerConversation, listMessengerConversations, listMessengerMessages } from '@/modules/messenger/queries'
import MessengerConversationRow from '@/modules/messenger/components/MessengerConversationRow'
import MessengerEmptyState, { type MessengerEmptyKind } from '@/modules/messenger/components/MessengerEmptyState'
import MessengerThread from '@/modules/messenger/components/MessengerThread'

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

type SearchParams = { c?: string; permission?: string }

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
    .select('page_id', 'granted_scopes')) as { page_id: string; granted_scopes: unknown }[]
  if (pages.length === 0) return empty('not-connected')

  const messagingPageIds = new Set(
    pages.filter((p) => hasFeatureScopes(parseGrantedScopes(p.granted_scopes), 'messenger')).map((p) => p.page_id),
  )
  const notice = sp.permission === 'missing' ? FACEBOOK_NOTICES.messenger_declined : FACEBOOK_NOTICES.messenger_permission
  const permissionPrompt = (
    <MetaPermissionPrompt
      notice={notice}
      href='/api/auth/facebook?feature=messenger'
      canAuthorize={isAdmin(user.role as Roles)}
      inAppBrowser={await getInAppBrowser()}
    />
  )
  if (messagingPageIds.size === 0) return shell(permissionPrompt)

  const selectedId = Number(sp.c)
  const [conversations, selected] = await Promise.all([
    listMessengerConversations(agencyId, user.id),
    Number.isInteger(selectedId) && selectedId > 0 ? getMessengerConversation(agencyId, user.id, selectedId) : null,
  ])
  // No conversation yet: one page-level state, not an empty list beside an empty thread.
  if (conversations.length === 0) {
    return shell(
      <>
        {sp.permission === 'granted' && (
          <p role='status' className='text-sm text-green-600'>ההרשאה אושרה. הודעות Messenger חדשות יופיעו כאן.</p>
        )}
        <MessengerEmptyState kind='no-conversations' compact={mobile} />
      </>,
    )
  }
  const messages = selected ? await listMessengerMessages(agencyId, selected.id) : []

  // The window is decided here, once, on the server — never re-derived in client render.
  const now = new Date()
  const replyWindow = selected ? messengerWindow(selected.lastInboundAt, now) : null
  const thread = selected ? (
    <MessengerThread
      conversation={selected}
      messages={messages}
      windowOpen={replyWindow!.open}
      windowHint={messengerWindowHint(replyWindow!, now)}
      canSend={messagingPageIds.has(selected.pageId)}
      permissionPrompt={permissionPrompt}
    />
  ) : null

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
        <div className='shrink-0 border-b border-gray-100 p-2 px-3'>
          <InboxChannelSwitch active='messenger' showMessenger />
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto'>{list}</div>
      </aside>
      <section aria-label='שיחה' className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'>
        {thread ?? <MessengerEmptyState kind='no-selection' />}
      </section>
    </div>
  )
}
