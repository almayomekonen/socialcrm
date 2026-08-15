import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { listInboxConversations, getInboxConversationById } from '@/modules/inbox/queries'
import { listConversationMessages } from '@/db/inboxMessages'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import ConversationListMobile from './ConversationListMobile'
import ConversationThreadMobile from './ConversationThreadMobile'
import { relativeTimeHe } from './relativeTime'
import LeadlessConversationActions from '@/components/inbox/LeadlessConversationActions'

/**
 * The mobile שיחות route — list, or one thread when `?conversation=` is set.
 *
 * MASTER/DETAIL BY URL, not by state. The desktop shows both panes at once; a
 * phone shows one, and which one is in the querystring — so browser back leaves
 * a thread and returns to the list, deep links from notifications open the right
 * conversation, and refresh keeps the user where they were.
 *
 * NO SECOND BACKEND. `listInboxConversations`, `getInboxConversationById` and
 * `listConversationMessages` are the existing reads, called with the existing
 * `agencyId`/`userId` scoping. A conversation belonging to another tenant
 * returns null here exactly as it does on desktop.
 *
 * Server Component: the list and thread arrive rendered, and only the composer
 * and the search box are client islands.
 */
export default async function MobileInboxRoute({
  agencyId,
  userId,
  q,
  conversationId,
}: {
  agencyId: number
  userId: number
  q: string
  conversationId: number | null
}) {
  if (conversationId != null) {
    // getInboxConversationById is agency-scoped; a foreign id yields null and
    // we fall back to the list rather than leaking existence.
    const target = await getInboxConversationById(agencyId, conversationId)
    if (!target) return <ConversationMissing />

    const [messages, wa] = await Promise.all([
      listConversationMessages(conversationId),
      getWhatsappConnectionState(userId),
    ])

    const name = target.displayName || target.leadName || 'שיחה'

    return (
      <div className='flex h-full min-h-0 flex-col'>
        {/* Thread header carries the one action the rep needs from here: open
            the lead. Back is the shell's header control. */}
        <div className='flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 py-2'>
          {/* Explicit back to the list. The shell's header cannot provide it —
              it keys off pathname, and list and thread share `/inbox` — and a
              thread with no visible way out relies on the browser chrome. */}
          <Link
            href={'/inbox' as Route}
            aria-label='חזרה לשיחות'
            className='flex size-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          >
            <Icon name='arrow-right' type='sol' className='size-5 bg-gray-600' />
          </Link>
          <p className='min-w-0 flex-1 truncate text-[15px] font-semibold text-ink'>{name}</p>
          {target.leadId != null ? (
            <Link
              href={`/clients/${target.leadId}/summary` as Route}
              className='flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-primary-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            >
              <Icon name='image-polaroid-user' type='sol' className='size-4 bg-primary' />
              <span>הליד</span>
            </Link>
          ) : (
            <LeadlessConversationActions conversationId={conversationId} isPersonal={target.isPersonal} />
          )}
        </div>

        <div className='min-h-0 flex-1'>
          <ConversationThreadMobile
            conversationId={conversationId}
            leadId={target.leadId}
            displayName={name}
            initialMessages={messages}
            canSend={wa.connected}
          />
        </div>
      </div>
    )
  }

  const page = await listInboxConversations(agencyId, userId, { filters: { q: q || null } })
  const nowMs = Date.now()

  return (
    <ConversationListMobile
      items={page.items}
      q={q}
      // Formatting happens on the server, per row, against ONE `nowMs`.
      formatWhen={(iso) => relativeTimeHe(iso, nowMs)}
    />
  )
}

function ConversationMissing() {
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='comments' type='sol' className='size-5 bg-gray-400' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-base font-bold text-ink'>השיחה לא נמצאה</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>ייתכן שהיא נמחקה או שאין לך גישה אליה.</p>
      </div>
      <Link
        href={'/inbox' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        כל השיחות
      </Link>
    </div>
  )
}
