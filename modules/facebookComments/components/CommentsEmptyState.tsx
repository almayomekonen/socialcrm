import Link from 'next/link'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Page-level states — never two at once (ux-guidelines §11).
 *
 * `not-enabled` is the dark-launch / preview state: the UI is reachable for
 * inspection, but ingest stays gated, so there is nothing to list yet.
 *
 * The old "awaiting App Review" state is gone: Meta approved
 * `pages_read_user_content`, and a comment that still arrives without text says
 * so on its own card ("תוכן התגובה לא התקבל מפייסבוק").
 *
 * Mirrors `modules/inbox/components/InboxEmptyState.tsx` in structure and tone.
 */
const COPY = {
  'not-enabled': { title: 'inbox.comments.empty.notEnabled.title', body: 'inbox.comments.empty.notEnabled.body' },
  'not-connected': { title: 'inbox.comments.empty.notConnected.title', body: 'inbox.comments.empty.notConnected.body' },
  'no-comments': { title: 'inbox.comments.empty.noComments.title', body: 'inbox.comments.empty.noComments.body' },
  // Filtered-empty (ux-guidelines §11): the status filter above stays visible, and "הכל" clears it.
  'no-open': { title: 'inbox.comments.empty.noOpen.title', body: 'inbox.comments.empty.noOpen.body' },
  'no-converted': { title: 'inbox.comments.empty.noConverted.title', body: 'inbox.comments.empty.noConverted.body' },
} as const satisfies Record<string, { title: MessageKey; body: MessageKey }>

/** The one next step a state offers, when it has one (ux-guidelines §4). */
const ACTION: Partial<Record<keyof typeof COPY, { href: string; label: MessageKey }>> = {
  'not-connected': { href: '/settings/integrations', label: 'inbox.comments.empty.notConnected.action' },
}

export type CommentsEmptyKind = keyof typeof COPY

export default function CommentsEmptyState({
  kind,
  compact = false,
  locale = 'he',
}: {
  kind: CommentsEmptyKind
  /** Phone chrome: rectangular mark. Desktop callers omit this — look is unchanged. */
  compact?: boolean
  /** The page's interface language; the phone inbox passes nothing (Hebrew). */
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const copy = COPY[kind]
  const action = ACTION[kind]

  return (
    <div className='flex flex-col items-center justify-center px-6 py-10 text-center'>
      <span
        className={
          compact
            ? 'flex size-10 items-center justify-center rounded-md border border-gray-200 bg-gray-50'
            : 'flex size-14 items-center justify-center rounded-full bg-gray-100'
        }
      >
        <ChannelIcon channel='facebook' className='size-6' />
      </span>
      <p className='mt-3 text-base font-medium text-gray-700'>{t(copy.title)}</p>
      <p className='mt-1 max-w-md text-sm text-gray-500'>{t(copy.body)}</p>
      {action && (
        <Link
          href={action.href}
          className='mt-3 text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        >
          {t(action.label)}
        </Link>
      )}
    </div>
  )
}
