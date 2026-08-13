import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'
import type { InboxConversationListItem } from '@/modules/inbox/types'
import ConversationSearchBar from './ConversationSearchBar'

/**
 * שיחות — the mobile conversation list.
 *
 * A messaging app's list, not the desktop inbox's three-pane workspace: one row
 * per conversation, name + last message + when + unread, and the whole row opens
 * the thread. The desktop toolbar (channel switch, six sort modes, seven intel
 * filters, smart counts) is deliberately absent — those are triage tools for a
 * wide screen, and reproducing them here would spend the entire viewport on
 * chrome before the first conversation.
 *
 * NO SECOND BACKEND. Rows come from `listInboxConversations` — the same query,
 * the same `agencyId`/`userId` scoping, the same cursor pagination the desktop
 * inbox uses. This file renders; it does not fetch, filter or decide.
 *
 * WHATSAPP ONLY, because `InboxChannel` is `'whatsapp'` and nothing else. No
 * channel switcher is shown, because there is nothing to switch to — offering
 * one would promise a capability the backend does not have.
 *
 * Server Component. Timestamps arrive preformatted from the server so no row
 * reads a clock (architecture-rules.md §11).
 */
export default function ConversationListMobile({
  items,
  q,
  formatWhen,
}: {
  items: InboxConversationListItem[]
  q: string
  /** Server-computed relative time, e.g. "לפני 4 דקות". */
  formatWhen: (iso: string | null) => string
}) {
  return (
    <div className='flex min-h-full flex-col'>
      <ConversationSearchBar q={q} resultCount={items.length} />

      {items.length === 0 ? (
        <EmptyConversations q={q} />
      ) : (
        <ul className='divide-y divide-gray-100'>
          {items.map((c) => (
            <li key={c.conversationId}>
              <ConversationRow item={c} when={formatWhen(c.lastMessageAt)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConversationRow({ item, when }: { item: InboxConversationListItem; when: string }) {
  const name = item.displayName || item.leadName || 'שיחה'
  const preview = item.lastMessagePreview?.trim() || (item.lastMessageAt ? '' : 'אין הודעות עדיין')

  return (
    <Link
      href={`/inbox?conversation=${item.conversationId}` as Route}
      /* The whole row is the target (min-h-16 = 64px). Unread rows get a tint
         AND a bold name — colour alone never carries state. */
      className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 transition-colors active:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
        item.unread ? 'bg-primary-tint/40' : 'bg-white hover:bg-gray-50'
      }`}
    >
      <span className='flex size-10 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10'>
        <Icon name='whatsapp' type='sol' className='size-5 bg-[#25D366]' />
      </span>

      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline gap-2'>
          <span className={`truncate text-[15px] leading-tight text-ink ${item.unread ? 'font-bold' : 'font-semibold'}`}>
            {name}
          </span>
          <span className='ms-auto shrink-0 text-[11px] tabular-nums leading-tight text-gray-400'>{when}</span>
        </span>
        <span className='mt-0.5 flex items-center gap-2'>
          <span className={`truncate text-[13px] leading-tight ${item.unread ? 'text-gray-700' : 'text-gray-500'}`}>
            {/* Direction is part of the meaning: "you replied" reads very
                differently from "they asked". */}
            {item.lastDirection === 'outbound' && preview ? 'את/ה: ' : ''}
            {preview}
          </span>
          {item.unread && (
            <span
              aria-hidden
              className='ms-auto size-2.5 shrink-0 rounded-full bg-primary'
            />
          )}
        </span>
      </span>
    </Link>
  )
}

function EmptyConversations({ q }: { q: string }) {
  if (q) {
    return (
      <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
        <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
          <Icon name='magnifying-glass' type='reg' className='size-5 bg-gray-400' />
        </span>
        <div className='max-w-[300px]'>
          <h2 className='text-base font-bold text-ink'>לא נמצאו שיחות</h2>
          <p className='mt-1 text-sm leading-relaxed text-gray-500'>{`אין תוצאות עבור "${q}".`}</p>
        </div>
        <Link
          href={'/inbox' as Route}
          className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          נקה חיפוש
        </Link>
      </div>
    )
  }

  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-14 items-center justify-center rounded-2xl bg-[#25D366]/10'>
        <Icon name='whatsapp' type='sol' className='size-6 bg-[#25D366]' />
      </span>
      <div className='max-w-[320px]'>
        <h2 className='text-lg font-bold leading-tight text-ink'>אין עדיין שיחות</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          כשלקוח ישלח הודעה בוואטסאפ, השיחה תופיע כאן.
        </p>
      </div>
      <Link
        href={'/settings/integrations' as Route}
        className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-5 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        הגדרות וואטסאפ
      </Link>
    </div>
  )
}
