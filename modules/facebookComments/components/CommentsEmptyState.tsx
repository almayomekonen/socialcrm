import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

/**
 * Page-level states — never two at once (ux-guidelines §11).
 *
 * `not-enabled` is the dark-launch / preview state: the UI is reachable for
 * inspection, but ingest stays gated, so there is nothing to list yet.
 *
 * `awaiting-text` is the honest state while Meta App Review is pending: the
 * comments arrive, but we are not permitted to read what they say. Saying that
 * plainly beats rendering empty bubbles that look like broken data — and it is
 * the difference between a user trusting the screen and doubting it.
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
  'awaiting-text': {
    title: 'תוכן התגובות עדיין לא זמין',
    body: 'אנחנו מקבלים את התגובות ואת שם המגיב, אבל פייסבוק עדיין לא מאפשר לקרוא את תוכן ההודעה.',
  },
} as const

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
    </div>
  )
}
