import Link from 'next/link'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

/**
 * Page-level Messenger states — exactly one at a time (ux-guidelines §11).
 * Mirrors CommentsEmptyState in structure and tone: what is happening, why it
 * matters, what to do next.
 */
const COPY = {
  'not-enabled': {
    title: 'הודעות Messenger',
    body: 'הודעות שנשלחות לדף הפייסבוק שלך ב-Messenger יופיעו כאן אחרי שהערוץ יופעל בחשבון.',
    action: null,
  },
  'not-connected': {
    title: 'דף הפייסבוק אינו מחובר',
    body: 'כדי לקבל הודעות Messenger מהדף ולהשיב להן מכאן, צריך לחבר את הדף קודם בהגדרות.',
    action: { href: '/settings/integrations?section=facebook', label: 'חבר דף פייסבוק' },
  },
  'no-conversations': {
    title: 'אין עדיין הודעות',
    body: 'כשמישהו ישלח הודעה לדף ב-Messenger, השיחה תופיע כאן ותוכל להשיב לה ולהפוך אותה לליד.',
    action: null,
  },
  'no-selection': {
    title: 'בחר שיחה',
    body: 'בחר שיחה מהרשימה כדי לקרוא את ההודעות ולהשיב.',
    action: null,
  },
} as const

export type MessengerEmptyKind = keyof typeof COPY

export default function MessengerEmptyState({ kind, compact = false }: { kind: MessengerEmptyKind; compact?: boolean }) {
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
      <p className='mt-3 text-base font-medium text-gray-700'>{copy.title}</p>
      <p className='mt-1 max-w-md text-sm text-gray-500'>{copy.body}</p>
      {copy.action && (
        <Link
          href={copy.action.href}
          className='mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        >
          {copy.action.label}
        </Link>
      )}
    </div>
  )
}
