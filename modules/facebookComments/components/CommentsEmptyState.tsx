import Link from 'next/link'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

/**
 * Page-level states — never two at once (ux-guidelines §11).
 *
 * `not-enabled` is the dark-launch / preview state: the UI is reachable for
 * inspection, but ingest stays gated, so there is nothing to list yet.
 *
 * `needs-reconnect` replaces the old "awaiting App Review" state now that Meta
 * approved `pages_read_user_content`: comments arrive, but a Page whose token
 * predates the grant still delivers no text. Saying so — with the one action
 * that fixes it — beats empty bubbles that look like broken data.
 *
 * Mirrors `modules/inbox/components/InboxEmptyState.tsx` in structure and tone.
 */
const COPY = {
  'not-enabled': {
    title: 'תגובות בפייסבוק',
    body: 'תגובות יופיעו כאן אוטומטית אחרי שתגובות פייסבוק יופעלו והדף מחובר.',
  },
  'not-connected': {
    title: 'דף הפייסבוק אינו מחובר',
    body: 'כדי לראות תגובות מהדף, צריך לחבר אותו קודם בהגדרות.',
  },
  'no-comments': {
    title: 'אין עדיין תגובות',
    body: 'תגובות חדשות על פוסטים בדף יופיעו כאן אוטומטית.',
  },
  // Filtered-empty (ux-guidelines §11): the status filter above stays visible, and "הכל" clears it.
  'no-open': {
    title: 'אין תגובות פתוחות',
    body: 'תגובות חדשות על פוסטים בדף יופיעו כאן אוטומטית. כל התגובות מופיעות תחת "הכל".',
  },
  'no-converted': {
    title: 'עדיין לא נוצרו לידים מתגובות',
    body: 'כשיוצרים ליד מתגובה, היא מופיעה כאן עם קישור לליד.',
  },
  // A connected Page whose token predates `pages_read_user_content`: an issued
  // token never gains a scope, so only reconnecting brings comment text.
  'needs-reconnect': {
    title: 'תוכן התגובות לא מגיע מאחד הדפים',
    body: 'פייסבוק שולח את תוכן התגובות רק אחרי חיבור מחדש של הדף. החיבור מחדש לוקח פחות מדקה.',
  },
} as const

/** The one next step a state offers, when it has one (ux-guidelines §4). */
const ACTION: Partial<Record<keyof typeof COPY, { href: string; label: string }>> = {
  'not-connected': { href: '/settings/integrations', label: 'חבר את דף הפייסבוק' },
  'needs-reconnect': { href: '/settings/integrations', label: 'חבר מחדש את הדף' },
}

export type CommentsEmptyKind = keyof typeof COPY

export default function CommentsEmptyState({
  kind,
  compact = false,
}: {
  kind: CommentsEmptyKind
  /** Phone chrome: rectangular mark. Desktop callers omit this — look is unchanged. */
  compact?: boolean
}) {
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
      <p className='mt-3 text-base font-medium text-gray-700'>{copy.title}</p>
      <p className='mt-1 max-w-md text-sm text-gray-500'>{copy.body}</p>
      {action && (
        <Link
          href={action.href}
          className='mt-3 text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
