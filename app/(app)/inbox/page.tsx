import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { listInboxConversations, getInboxConversationById, getInboxSmartCounts } from '@/modules/inbox/queries'
import { parseInboxFilters, inboxFiltersKey } from '@/modules/inbox/filters'
import InboxConversationList from '@/modules/inbox/components/InboxConversationList'
import InboxToolbar from '@/modules/inbox/components/InboxToolbar'
import InboxWorkspace from '@/modules/inbox/components/InboxWorkspace'
import InboxEmptyState from '@/modules/inbox/components/InboxEmptyState'
import LeadIntelligenceCard from '@/components/ai/LeadIntelligenceCard'
import LeadIntelligenceCardSkeleton from '@/components/ai/LeadIntelligenceCardSkeleton'
import ConversationIntelligenceCard from '@/modules/inbox/components/ConversationIntelligenceCard'

type InboxSearchParams = {
  conversation?: string
  q?: string
  status?: string
  unread?: string
  needsReply?: string
  intel?: string
  sort?: string
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<InboxSearchParams> }) {
  const user = await getUser()
  if (!user?.agencyId) {
    console.log(
      JSON.stringify({
        tag: 'AUTH_REDIRECT',
        route: '/inbox',
        reason: user ? 'missing_agencyId' : 'getUser_returned_null',
        userId: user?.id ?? null,
        email: user?.email ?? null,
        ts: new Date().toISOString(),
      }),
    )
    redirect('/auth')
  }

  const sp = await searchParams
  const selectedConversationId =
    sp.conversation && Number.isFinite(Number(sp.conversation)) ? Number(sp.conversation) : null
  const filters = parseInboxFilters(sp)

  const [firstPage, smartCounts, selected] = await Promise.all([
    listInboxConversations(user.agencyId, user.id, { filters }),
    getInboxSmartCounts(user.agencyId),
    selectedConversationId ? getInboxConversationById(user.agencyId, selectedConversationId) : Promise.resolve(null),
  ])

  return (
    <div className='flex h-[calc(100dvh-6rem)] min-h-0 gap-3'>
      {/* Conversation list */}
      <aside className='flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white'>
        <InboxToolbar filters={filters} selectedConversation={selectedConversationId} smartCounts={smartCounts} />
        <InboxConversationList
          key={inboxFiltersKey(filters)}
          initialItems={firstPage.items}
          initialCursor={firstPage.nextCursor}
          selectedConversationId={selectedConversationId}
          filters={filters}
        />
      </aside>

      {/* Workspace */}
      <main className='min-w-0 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white'>
        {selected ? (
          <InboxWorkspace conversationId={selected.conversationId} leadId={selected.leadId} channel={selected.channel} />
        ) : (
          <InboxEmptyState hasConversations={firstPage.items.length > 0} />
        )}
      </main>

      <aside className='hidden w-80 shrink-0 overflow-y-auto xl:block'>
        {selected ? (
          <>
            <Suspense fallback={null}>
              <ConversationIntelligenceCard agencyId={user.agencyId} conversationId={selected.conversationId} />
            </Suspense>
            <Suspense fallback={<LeadIntelligenceCardSkeleton />}>
              <LeadIntelligenceCard leadId={selected.leadId} />
            </Suspense>
          </>
        ) : null}
      </aside>
    </div>
  )
}
