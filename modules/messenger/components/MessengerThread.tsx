import { formatBusinessDate as formatDate, formatBusinessTime as formatTime } from '@/lib/today/time'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import type { MessengerAttachment } from '@/lib/facebook/messenger/parseMessagingEvent'
import type { MessengerConversationListItem, MessengerMessage } from '../types'
import MessengerComposer from './MessengerComposer'
import MessengerLeadActions from './MessengerLeadActions'
import MessengerReadMarker from './MessengerReadMarker'

const WALLPAPER = 'bg-bg bg-[radial-gradient(var(--color-primary-soft)_1px,transparent_1px)] bg-size-[16px_16px]'

const SOURCE_LABEL: Record<MessengerMessage['source'], string | null> = {
  customer: null,
  socialcrm: null,
  page_inbox: 'נשלח מתיבת ההודעות של הדף',
  other_app: 'נשלח מאפליקציה אחרת',
}

const UNSUPPORTED = 'סוג הודעה שלא ניתן להציג כאן. אפשר לראות אותה בתיבת ההודעות של הדף ב-Meta Business Suite.'

function Attachment({ a }: { a: MessengerAttachment }) {
  if (a.type === 'unsupported' || !a.url) return <p className='text-xs text-gray-500 italic'>{UNSUPPORTED}</p>
  if (a.type === 'image') {
    return (
      <a href={a.url} target='_blank' rel='noopener noreferrer' className='block'>
        {/* eslint-disable-next-line @next/next/no-img-element -- Meta CDN URL, not a static asset */}
        <img src={a.url} alt='תמונה שהתקבלה ב-Messenger' loading='lazy' referrerPolicy='no-referrer' className='max-h-60 rounded-lg' />
      </a>
    )
  }
  const label = a.type === 'video' ? 'פתח סרטון' : a.type === 'audio' ? 'פתח הקלטה' : 'פתח קובץ מצורף'
  return (
    <a href={a.url} target='_blank' rel='noopener noreferrer' className='text-sm text-primary underline underline-offset-2'>
      {label}
    </a>
  )
}

/**
 * Messenger conversation workspace: header with lead association, the message
 * history, and the composer. Bubble anatomy follows WhatsappConversation.
 * `window` is decided on the server and passed in.
 */
export default function MessengerThread({
  conversation,
  messages,
  windowOpen,
  windowHint,
  canSend,
  permissionPrompt,
}: {
  conversation: MessengerConversationListItem
  messages: MessengerMessage[]
  windowOpen: boolean
  windowHint: string | null
  /** False when the Page's grant lacks pages_messaging — then `permissionPrompt` explains. */
  canSend: boolean
  permissionPrompt: React.ReactNode
}) {
  const name = conversation.leadName ?? conversation.customerName ?? 'פונה מ-Messenger'
  const thread = messages
    .map((m, i) => ({ m, newDay: i === 0 || formatDate(messages[i - 1].timestamp) !== formatDate(m.timestamp) }))
    .reverse()

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <MessengerReadMarker conversationId={conversation.id} latestMessageId={messages.at(-1)?.id ?? null} />

      <header className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5'>
        <div className='min-w-0'>
          <p className='truncate text-base font-semibold text-gray-900'>{name}</p>
          <p className='inline-flex items-center gap-1 text-xs text-gray-500'>
            <ChannelIcon channel='messenger' className='size-3' />
            Messenger
          </p>
        </div>
        <MessengerLeadActions conversationId={conversation.id} leadId={conversation.leadId} leadName={conversation.leadName} />
      </header>

      <div role='group' aria-label='הודעות השיחה' className={`flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-3 ${WALLPAPER}`}>
        {thread.map(({ m, newDay }) => {
          const inbound = m.direction === 'inbound'
          const label = SOURCE_LABEL[m.source]
          return (
            <div key={m.id} className='mt-1.5'>
              {newDay && (
                <div className='flex justify-center pb-1.5 pt-2.5'>
                  <span suppressHydrationWarning className='rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-gray-500'>
                    {formatDate(m.timestamp)}
                  </span>
                </div>
              )}
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
                    <span dir='ltr' suppressHydrationWarning className='shrink-0 pb-px text-[10px] tabular-nums text-gray-500'>
                      {formatTime(m.timestamp)}
                    </span>
                  </div>
                  {label && <p className='mt-0.5 text-[10px] text-gray-500'>{label}</p>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className='shrink-0 border-t border-gray-100 bg-white px-3 py-2.5'>
        {canSend ? (
          <MessengerComposer conversationId={conversation.id} windowOpen={windowOpen} windowHint={windowHint} />
        ) : (
          permissionPrompt
        )}
      </div>
    </div>
  )
}
