import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { listInboxConversations, getInboxConversationById } from '@/modules/inbox/queries'
import { listConversationMessages } from '@/db/inboxMessages'
import { getUser } from '@/db/auth'
import { loadWhatsappComposerContext } from '@/lib/inbox/whatsappComposerContext'
import ConversationListMobile from './ConversationListMobile'
import ConversationThreadMobile from './ConversationThreadMobile'
import { relativeTimeHe } from './relativeTime'
import { statusStyle } from '@/lib/leads/statusStyles'
import LeadlessConversationActions from '@/components/inbox/LeadlessConversationActions'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'

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

    const user = await getUser()
    const [messages, composerFacts] = await Promise.all([
      listConversationMessages(conversationId),
      loadWhatsappComposerContext(agencyId, conversationId, { role: user?.role }),
    ])

    const name = target.displayName || target.leadName || 'שיחה'

    /**
     * Secondary context under the name: lead status, then how long since the
     * last message — "מתעניין · לפני 4 דקות".
     *
     * Both parts are optional and the line is omitted entirely when neither is
     * known, rather than rendering a stray separator. Recency is formatted here,
     * on the server, against one `Date.now()` — the same rule every other mobile
     * timestamp follows (architecture-rules.md §11).
     */
    // The thread's own last message — already loaded, so no extra query and no
    // field invented on the conversation row.
    const lastMessageAt = messages.length ? messages[messages.length - 1].timestamp : null

    const headerMeta =
      [
        target.leadStatus ? statusStyle(target.leadStatus).label : null,
        relativeTimeHe(lastMessageAt, Date.now()) || null,
      ]
        .filter(Boolean)
        .join(' · ') || null

    return (
      <div className='flex h-full min-h-0 flex-col overflow-hidden'>
        {/*
          THREAD HEADER — who am I talking to, on what channel, and how fresh.
          The messaging convention: back, identity, then the one onward action.

          It used to be back + name + a text link labelled "הליד". The name was
          right, but the header said nothing about WHICH channel this is or when
          the customer last spoke, and the widest element in it was a generic
          word. Now the channel mark sits with the name, the status and recency
          sit under it, and the lead link is an icon button with an accessible
          name — the same information in less space, with the generic label gone.

          Back is explicit: the shell's header keys off pathname, and the list
          and the thread share `/inbox`, so it cannot supply one.

          Leadless actions sit on a second chrome row, not in the identity row:
          wrapping three pills next to the name blew the header height and
          painted gray-on-green desktop chips onto the WhatsApp bar.
        */}
        <div
          data-testid='wa-thread-header'
          data-wa-thread-chrome
          className='flex shrink-0 flex-col bg-[#008069] pt-[max(0.375rem,env(safe-area-inset-top,0px))]'
        >
          <div className='flex items-center gap-1 px-1.5 pb-1.5'>
            <Link
              href={'/inbox' as Route}
              aria-label='חזרה לשיחות'
              className='press flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white'
            >
              <Icon name='arrow-right' type='sol' className='size-5 bg-white' />
            </Link>

            <span
              aria-hidden
              className='flex size-9 shrink-0 items-center justify-center rounded-full bg-white'
            >
              <Icon name='whatsapp' type='sol' className='size-[18px] bg-[#25D366]' />
            </span>

            <div className='min-w-0 flex-1 ps-1'>
              <h1 className='truncate text-[15px] font-semibold leading-tight text-white'>{name}</h1>
              {headerMeta && <p className='truncate text-[12px] leading-tight text-white/80'>{headerMeta}</p>}
            </div>

            {target.leadId != null ? (
              <Link
                href={`/clients/${target.leadId}/summary` as Route}
                aria-label={`פתח את הליד ${name}`}
                className='press flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white'
              >
                <Icon name='image-polaroid-user' type='sol' className='size-5 bg-white' />
              </Link>
            ) : null}
          </div>

          {target.leadId == null ? (
            <div className='border-t border-white/20 px-3 py-2'>
              <LeadlessConversationActions
                conversationId={conversationId}
                isPersonal={target.isPersonal}
                tone='onGreen'
              />
            </div>
          ) : null}
        </div>

        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <ConversationThreadMobile
            conversationId={conversationId}
            leadId={target.leadId}
            displayName={name}
            initialMessages={messages}
            composerFacts={composerFacts}
          />
        </div>
      </div>
    )
  }

  const page = await listInboxConversations(agencyId, userId, { filters: { q: q || null } })
  const nowMs = Date.now()

  return (
    <div>
      <div className='border-b border-gray-200 bg-white px-3 py-2 [&_a]:min-h-11 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
        <InboxChannelSwitch active='whatsapp' />
      </div>
      <ConversationListMobile
        items={page.items}
        q={q}
        nextCursor={page.nextCursor}
        // Formatting happens on the server, per row, against ONE `nowMs`.
        formatWhen={(iso) => relativeTimeHe(iso, nowMs)}
      />
    </div>
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
