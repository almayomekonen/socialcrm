import Link from 'next/link'
import ChannelIcon from './ChannelIcon'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Small channel switch inside the existing שיחות experience (Facebook Comments
 * plan decision D1). WhatsApp conversations and Facebook comments share one
 * nav section — no new top-level item.
 */
export type InboxChannelTab = 'whatsapp' | 'facebook' | 'messenger'

/** `label` is a catalog key, or null for a brand name shown as written. */
const TABS: { id: InboxChannelTab; href: string; label: MessageKey | null }[] = [
  { id: 'whatsapp', href: '/inbox', label: 'inbox.channels.whatsapp' },
  { id: 'messenger', href: '/inbox/messenger', label: null },
  { id: 'facebook', href: '/inbox/comments', label: 'inbox.channels.facebook' },
]

/**
 * `showMessenger` is resolved server-side from the Messenger rollout gate, so an
 * agency without Messenger never sees a tab that leads nowhere. Default false:
 * every existing caller renders exactly the two tabs it rendered before.
 *
 * `locale` is the caller's interface language. Hebrew by default: the phone
 * inbox (not translated yet) passes nothing, or Hebrew.
 */
export default function InboxChannelSwitch({
  active,
  showMessenger = false,
  messengerUnread = 0,
  locale = 'he',
}: {
  active: InboxChannelTab
  locale?: UiLocale
  showMessenger?: boolean
  /**
   * Unread Messenger conversations for THIS user. Its own signal, deliberately
   * not merged into the global inbox badge — that one counts WhatsApp, and a
   * single number across two inboxes cannot be acted on without guessing which
   * to open. Zero renders nothing: a badge showing 0 is noise.
   */
  messengerUnread?: number
}) {
  const t = translatorFor(locale)
  const tabs = TABS.filter((tab) => tab.id !== 'messenger' || showMessenger || active === 'messenger')
  return (
    <nav aria-label={t('inbox.channels.label')} className='flex flex-wrap items-center gap-1.5'>
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              isActive
                ? 'border-info-border bg-primary-tint text-primary-text font-medium'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <ChannelIcon channel={tab.id} className='size-3.5' />
            {tab.label ? t(tab.label) : 'Messenger'}
            {tab.id === 'messenger' && messengerUnread > 0 && (
              <span
                // The count is in the accessible name, so it is not colour-only.
                // Counts as text so Hebrew stays exactly as before (no digit grouping).
                aria-label={t('inbox.channels.messengerUnread', { count: String(messengerUnread) })}
                className='inline-flex min-w-4 items-center justify-center rounded-full bg-success px-1 text-[10px] font-semibold leading-4 text-white'
              >
                {messengerUnread > 99 ? '99+' : messengerUnread}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
