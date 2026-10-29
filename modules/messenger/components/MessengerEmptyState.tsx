import Link from 'next/link'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Page-level Messenger states — exactly one at a time (ux-guidelines §11).
 * Mirrors CommentsEmptyState in structure and tone: what is happening, why it
 * matters, what to do next.
 *
 * `locale`: the page's interface language (the phone branch passes nothing and
 * stays Hebrew until the mobile inbox is translated).
 */
const COPY = {
  'not-enabled': { title: 'inbox.messenger.empty.notEnabled.title', body: 'inbox.messenger.empty.notEnabled.body', action: null },
  'not-connected': {
    title: 'inbox.messenger.empty.notConnected.title',
    body: 'inbox.messenger.empty.notConnected.body',
    action: { href: '/settings/integrations?section=facebook', label: 'inbox.messenger.empty.notConnected.action' },
  },
  'no-conversations': {
    title: 'inbox.messenger.empty.noConversations.title',
    body: 'inbox.messenger.empty.noConversations.body',
    action: null,
  },
  'no-selection': { title: 'inbox.messenger.empty.noSelection.title', body: 'inbox.messenger.empty.noSelection.body', action: null },
} as const satisfies Record<string, { title: MessageKey; body: MessageKey; action: { href: string; label: MessageKey } | null }>

export type MessengerEmptyKind = keyof typeof COPY

export default function MessengerEmptyState({
  kind,
  compact = false,
  locale = 'he',
}: {
  kind: MessengerEmptyKind
  compact?: boolean
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const copy = COPY[kind]
  return (
    <div className='flex flex-col items-center justify-center px-6 py-10 text-center'>
      <span
        className={
          compact
            ? 'flex size-10 items-center justify-center rounded-md border border-gray-200 bg-gray-50'
            : 'flex size-14 items-center justify-center rounded-full bg-gray-100'
        }
      >
        <ChannelIcon channel='messenger' className='size-6' />
      </span>
      <p className='mt-3 text-base font-medium text-gray-700'>{t(copy.title)}</p>
      <p className='mt-1 max-w-md text-sm text-gray-500'>{t(copy.body)}</p>
      {copy.action && (
        <Link
          href={copy.action.href}
          className='mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        >
          {t(copy.action.label)}
        </Link>
      )}
    </div>
  )
}
