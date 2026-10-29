import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { listInboxConversations, getInboxConversationById, getInboxSmartCounts } from '@/modules/inbox/queries'
import { parseInboxFilters, inboxFiltersKey } from '@/modules/inbox/filters'
import InboxConversationList from '@/modules/inbox/components/InboxConversationList'
import { InboxStoreProvider } from '@/modules/inbox/client/inboxStore'
import { isInboxDeltaSyncEnabled, getInboxRefreshIntervalMs } from '@/lib/flags/inboxFlags'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import MobileInboxRoute from '@/modules/inbox/mobile/MobileInboxRoute'
import ConversationRefreshPoller from '@/components/summary/ConversationRefreshPoller'
import InboxLiveModeLog from '@/components/summary/InboxLiveModeLog'
import InboxToolbar from '@/modules/inbox/components/InboxToolbar'
import { countUnreadMessengerConversations } from '@/modules/messenger/queries'
import InboxWorkspace from '@/modules/inbox/components/InboxWorkspace'
import InboxEmptyState from '@/modules/inbox/components/InboxEmptyState'
import CrmSyncBanner from '@/components/clients/CrmSyncBanner'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'
import ConversationIntelligenceCard from '@/modules/inbox/components/ConversationIntelligenceCard'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

type InboxSearchParams = {
  conversation?: string
  q?: string
  status?: string
  unread?: string
  needsReply?: string
  intel?: string
  sort?: string
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('inbox.page.title') }
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')

  const sp = await searchParams
  const selectedConversationId =
    sp.conversation && Number.isFinite(Number(sp.conversation)) ? Number(sp.conversation) : null
  const filters = parseInboxFilters(sp)

  /**
   * MOBILE שיחות. The desktop inbox is a three-pane workspace (list + thread +
   * intelligence card) with a toolbar carrying a channel switch, six sort modes
   * and seven intel filters. On a phone that is chrome before content, so the
   * mobile branch renders a messaging-style list/thread over the SAME queries.
   *
   * Returned BEFORE the desktop's parallel reads, so a phone does no wasted work
   * and receives no desktop markup (architecture-rules.md §9).
   */
  const mobile = (await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)

  /**
   * Interface language, resolved once (the same request-memoised read as the
   * layout), for the phone and desktop branches alike. Hebrew outside the
   * rollout, with no query. Server pieces take it as a prop; client pieces read
   * the layout's provider (same value).
   */
  const { locale } = await getUiLocaleState(user)

  if (mobile) {
    return (
      <MobileInboxRoute
        agencyId={user.agencyId}
        userId={user.id}
        q={filters.q ?? ''}
        conversationId={selectedConversationId}
        locale={locale}
      />
    )
  }

  const t = translatorFor(locale)

  const [firstPage, smartCounts, selected] = await Promise.all([
    listInboxConversations(user.agencyId, user.id, { filters, locale }),
    getInboxSmartCounts(user.agencyId),
    selectedConversationId ? getInboxConversationById(user.agencyId, selectedConversationId) : Promise.resolve(null),
  ])

  // The WhatsApp inbox is where a rep spends the day; without this they would
  // never learn a Messenger customer wrote unless they opened that tab.
  const messengerEnabled = isFacebookMessengerEnabledForAgency(user.agencyId)
  const messengerUnread = messengerEnabled
    ? await countUnreadMessengerConversations(user.agencyId, user.id).catch(() => 0)
    : 0

  const deltaSyncEnabled = isInboxDeltaSyncEnabled()
  const refreshMs = getInboxRefreshIntervalMs(deltaSyncEnabled)

  return (
    <InboxStoreProvider
      initialItems={firstPage.items}
      initialCursor={firstPage.nextCursor}
      filters={filters}
      filtersKey={inboxFiltersKey(filters)}
      deltaSyncEnabled={deltaSyncEnabled}
    >
      <div className='flex h-[calc(100dvh-6rem)] min-h-0 gap-3' {...regionAttrs(locale)}>
        <InboxLiveModeLog deltaSyncEnabled={deltaSyncEnabled} refreshMs={refreshMs} />
        {refreshMs != null ? <ConversationRefreshPoller intervalMs={refreshMs} /> : null}

        <aside className='flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'>
          <div data-alert-region='crm-sync' className='shrink-0'>
            <CrmSyncBanner sources={['inbox-sync']} compact />
          </div>
          <InboxToolbar
            filters={filters}
            selectedConversation={selectedConversationId}
            smartCounts={smartCounts}
            showMessenger={messengerEnabled}
            messengerUnread={messengerUnread}
          />
          <InboxConversationList selectedConversationId={selectedConversationId} />
        </aside>

        <section
          aria-label={t('inbox.page.conversation')}
          className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'
        >
          {selected ? (
            <InboxWorkspace
              conversationId={selected.conversationId}
              leadId={selected.leadId}
              isPersonal={selected.isPersonal}
              channel={selected.channel}
              displayName={selected.displayName}
              leadStatus={selected.leadStatus}
              customerWaId={selected.customerWaId}
              locale={locale}
            />
          ) : (
            <InboxEmptyState hasConversations={firstPage.items.length > 0} locale={locale} />
          )}
        </section>

        <aside className='hidden w-80 shrink-0 overflow-y-auto xl:block'>
          {selected && selected.leadId != null ? (
            <>
              <Suspense fallback={null}>
                <ConversationIntelligenceCard agencyId={user.agencyId} conversationId={selected.conversationId} locale={locale} />
              </Suspense>
              <Suspense fallback={<LeadIntelligenceCardSkeleton locale={locale} />}>
                <LeadIntelligenceCard leadId={selected.leadId} locale={locale} />
              </Suspense>
            </>
          ) : null}
        </aside>
      </div>
    </InboxStoreProvider>
  )
}
