import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

/**
 * Three distinct page-level states — never two at once (ux-guidelines §11).
 *
 * `awaiting-text` is the honest state while Meta App Review is pending: the
 * comments arrive, but we are not permitted to read what they say. Saying that
 * plainly beats rendering empty bubbles that look like broken data — and it is
 * the difference between a user trusting the screen and doubting it.
 *
 * Mirrors `modules/inbox/components/InboxEmptyState.tsx` in structure and tone.
 */
const COPY = {
  'not-connected': {
    title: 'דף הפייסבוק אינו מחובר',
    body: 'כדי לראות תגובות מהדף, צריך לחבר אותו קודם בהגדרות.',
  },
  'no-comments': {
    title: 'אין עדיין תגובות',
    body: 'תגובות חדשות על פוסטים בדף יופיעו כאן אוטומטית.',
  },
  'awaiting-text': {
    title: 'תוכן התגובות עדיין לא זמין',
    body: 'אנחנו מקבלים את התגובות ואת שם המגיב, אבל פייסבוק עדיין לא מאפשר לקרוא את תוכן ההודעה.',
  },
} as const

export type CommentsEmptyKind = keyof typeof COPY

export default function CommentsEmptyState({ kind }: { kind: CommentsEmptyKind }) {
  const copy = COPY[kind]

  return (
    <div className='flex flex-col items-center justify-center px-6 py-10 text-center'>
      <span className='flex size-14 items-center justify-center rounded-full bg-gray-100'>
        <ChannelIcon channel='facebook' className='size-6' />
      </span>
      <p className='mt-3 text-base font-medium text-gray-700'>{copy.title}</p>
      <p className='mt-1 max-w-md text-sm text-gray-500'>{copy.body}</p>
    </div>
  )
}
