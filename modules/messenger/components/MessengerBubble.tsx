import type { MessengerConversationEvent, MessengerMessage } from '../types'
import { formatBusinessTime as formatTime } from '@/lib/today/time'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'
import MessengerMessageStatus from './MessengerMessageStatus'

/**
 * One message bubble: attachments, text, time, and the delivery state.
 *
 * Extracted from MessengerThread so the server-rendered thread and the client
 * "load earlier" list render a message identically — two copies of bubble
 * anatomy is how an older message ends up looking subtly different from a new
 * one in the same conversation.
 */

const SOURCE_LABEL: Record<MessengerMessage['source'], string | null> = {
  customer: null,
  socialcrm: null,
  page_inbox: 'נשלח מתיבת ההודעות של הדף',
  other_app: 'נשלח מאפליקציה אחרת',
}

const UNSUPPORTED = 'סוג הודעה שלא ניתן להציג כאן. אפשר לראות אותה בתיבת ההודעות של הדף ב-Meta Business Suite.'

/**
 * One received attachment.
 *
 * Every branch renders SOMETHING truthful. An attachment Meta sent without a
 * usable URL still produces a visible marker, because silently dropping it
 * would make the thread read as if the customer sent nothing — the one failure
 * that loses a rep the plot of a conversation.
 *
 * Audio and video are played in place: a rep triaging a voice note should not
 * have to leave for Facebook. `preload='metadata'` keeps the list cheap.
 */
function Attachment({ a }: { a: MessengerAttachment }) {
  // Shared link / structured template: no media, but there IS content.
  if (a.type === 'share') {
    if (!a.url) return <p className='text-xs italic text-gray-500'>{a.title || 'תוכן משותף'}</p>
    return (
      <a
        href={a.url}
        target='_blank'
        rel='noopener noreferrer nofollow'
        className='block text-sm text-primary underline underline-offset-2'
      >
        {a.title || 'תוכן משותף'}
      </a>
    )
  }

  if (a.type === 'unsupported' || !a.url) return <p className='text-xs italic text-gray-500'>{UNSUPPORTED}</p>

  if (a.type === 'image') {
    // A sticker is not a photo: no bubble chrome, no link-out, smaller.
    if (a.sticker) {
      /* eslint-disable-next-line @next/next/no-img-element -- Meta CDN URL, not a static asset */
      return <img src={a.url} alt='מדבקה' loading='lazy' referrerPolicy='no-referrer' className='max-h-28' />
    }
    return (
      <a href={a.url} target='_blank' rel='noopener noreferrer' className='block'>
        {/* eslint-disable-next-line @next/next/no-img-element -- Meta CDN URL, not a static asset */}
        <img src={a.url} alt='תמונה שהתקבלה ב-Messenger' loading='lazy' referrerPolicy='no-referrer' className='max-h-60 rounded-lg' />
      </a>
    )
  }

  if (a.type === 'audio') {
    return <audio controls preload='metadata' src={a.url} className='mt-1 max-w-full' aria-label='הקלטה שהתקבלה ב-Messenger' />
  }

  if (a.type === 'video') {
    return (
      <video controls preload='metadata' src={a.url} className='mt-1 max-h-60 rounded-lg' aria-label='סרטון שהתקבל ב-Messenger' />
    )
  }

  return (
    <a
      href={a.url}
      target='_blank'
      rel='noopener noreferrer'
      download
      className='text-sm text-primary underline underline-offset-2'
    >
      הורד קובץ מצורף
    </a>
  )
}


export default function MessengerBubble({
  message: m,
  reactions = [],
}: {
  message: MessengerMessage
  /**
   * Reactions Meta reported for THIS message. Rendered on the bubble rather
   * than as a timeline entry: a reaction is a comment on something, not a thing
   * said, and it must never look like the customer wrote again.
   */
  reactions?: MessengerConversationEvent[]
}) {
  const inbound = m.direction === 'inbound'
  const label = SOURCE_LABEL[m.source]
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-2xl border px-3 py-1.5 xl:max-w-[70%] ${
          inbound ? 'border-gray-200 bg-white' : 'border-success-border bg-success-bg'
        }`}
      >
        <span className='sr-only'>{inbound ? 'הודעה נכנסת' : 'הודעה שנשלחה מהדף'}</span>
        {m.attachments.map((a, i) => (
          <Attachment key={i} a={a} />
        ))}
        <div className='flex items-end gap-2'>
          {(m.text || m.attachments.length === 0) && (
            <p className='min-w-0 whitespace-pre-wrap wrap-break-word text-sm leading-normal text-gray-800'>
              {m.text || UNSUPPORTED}
            </p>
          )}
          <span dir='ltr' className='flex shrink-0 items-center gap-1 pb-px'>
            <span suppressHydrationWarning className='text-[10px] tabular-nums text-gray-500'>
              {formatTime(m.timestamp)}
            </span>
            <MessengerMessageStatus message={m} />
          </span>
        </div>
        {label && <p className='mt-0.5 text-[10px] text-gray-500'>{label}</p>}
        {reactions.length > 0 && (
          <p className='mt-0.5 flex items-center gap-1'>
            <span className='sr-only'>תגובות להודעה:</span>
            {reactions.map((r) => (
              <span key={r.id} className='rounded-full bg-white px-1.5 py-0.5 text-[11px] leading-none shadow-sm ring-1 ring-gray-200'>
                {/* Meta's own emoji, never one we chose. A reaction with no
                    emoji (Meta sends the type only) is shown as a neutral mark. */}
                {r.payload || '•'}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
