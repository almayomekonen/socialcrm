import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import { listInboxConversations, getInboxConversationById } from '@/modules/inbox/queries'
import { listConversationMessages } from '@/db/inboxMessages'
import { getUser } from '@/db/auth'
import { loadWhatsappComposerContext } from '@/lib/inbox/whatsappComposerContext'
import ConversationListMobile from './ConversationListMobile'
import ConversationThreadMobile from './ConversationThreadMobile'
import MobileInboxReadMarker from './MobileInboxReadMarker'
import { relativeTime } from './relativeTime'
import { STATUS_STYLES, leadStatusLabel } from '@/lib/leads/statusStyles'
import LeadlessConversationActions from '@/components/inbox/LeadlessConversationActions'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import { countUnreadMessengerConversations } from '@/modules/messenger/queries'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

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
 *
 * LANGUAGE: `locale` is the interface language the page resolved once; this
 * route's roots declare it (the mobile shell around them is not translated yet)
 * and server-made text — the header line, relative times, the rows' waiting
 * copy — is produced in it. Client pieces read the layout's provider (same value).
 */
export default async function MobileInboxRoute({
  agencyId,
  userId,
  q,
  conversationId,
  locale = 'he',
}: {
  agencyId: number
  userId: number
  q: string
  conversationId: number | null
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  if (conversationId != null) {
    // getInboxConversationById is agency-scoped; a foreign id yields null and
    // we fall back to the list rather than leaking existence.
    const target = await getInboxConversationById(agencyId, conversationId)
    if (!target) return <ConversationMissing locale={locale} />

    const user = await getUser()
    const [messages, composerFacts] = await Promise.all([
      listConversationMessages(conversationId),
      loadWhatsappComposerContext(agencyId, conversationId, { role: user?.role }),
    ])

    const name = target.displayName || target.leadName || t('inbox.row.fallbackName')

    // Back returns to the list the rep actually came from, search included.
    // A bare '/inbox' here silently discarded an active search and dropped them
    // into the full list, which reads as the app losing their place.
    const backHref = q ? `/inbox?q=${encodeURIComponent(q)}` : '/inbox'

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
        // By the status CODE; an unknown code reads as "new", as statusStyle always did.
        target.leadStatus ? leadStatusLabel(STATUS_STYLES[target.leadStatus] ? target.leadStatus : 'new', locale) : null,
        relativeTime(lastMessageAt, Date.now(), locale) || null,
      ]
        .filter(Boolean)
        .join(' · ') || null

    return (
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden' {...regionAttrs(locale)}>
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
              href={backHref as Route}
              aria-label={t('inbox.messenger.error.back')}
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
                aria-label={t('inbox.mobile.thread.openLead', { name })}
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
                translated
              />
            </div>
          ) : null}
        </div>

        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <MobileInboxReadMarker
            conversationId={conversationId}
            latestMessageId={messages.length > 0 ? messages[messages.length - 1].id : null}
          />
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

  const page = await listInboxConversations(agencyId, userId, { filters: { q: q || null }, locale })
  const nowMs = Date.now()

  const messengerEnabled = isFacebookMessengerEnabledForAgency(agencyId)
  // Mobile has no Messenger tab of its own; this badge is the only place a rep
  // on the phone learns that a Messenger customer wrote.
  const messengerUnread = messengerEnabled ? await countUnreadMessengerConversations(agencyId, userId).catch(() => 0) : 0

  return (
    <div {...regionAttrs(locale)}>
      <div className='border-b border-gray-200 bg-white px-3 py-2 [&_a]:min-h-11 [&_a]:rounded-md [&_a]:px-3 [&_a]:text-sm'>
        <InboxChannelSwitch active='whatsapp' showMessenger={messengerEnabled} messengerUnread={messengerUnread} locale={locale} />
      </div>
      <ConversationListMobile
        items={page.items}
        q={q}
        nextCursor={page.nextCursor}
        // Formatting happens on the server, per row, against ONE `nowMs`.
        formatWhen={(iso) => relativeTime(iso, nowMs, locale)}
      />
    </div>
  )
}

function ConversationMissing({ locale }: { locale: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center' {...regionAttrs(locale)}>
      <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
        <Icon name='comments' type='sol' className='size-5 bg-gray-400' />
      </span>
      <div className='max-w-[300px]'>
        <h2 className='text-base font-bold text-ink'>{t('inbox.leadless.notFound')}</h2>
        <p className='mt-1 text-sm leading-relaxed text-gray-500'>{t('inbox.mobile.thread.missingBody')}</p>
      </div>
      <Link
        href={'/inbox' as Route}
        className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {t('inbox.toolbar.intel.all')}
      </Link>
    </div>
  )
}
