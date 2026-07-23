import type { ReactNode } from 'react'
import { formatDate, formatTime } from '@/lib/dates'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'
import WhatsappNewMessageNotifier from '@/components/summary/WhatsappNewMessageNotifier'
import WhatsappConversationHeader from '@/components/summary/WhatsappConversationHeader'
import WhatsappMessageStatus from '@/components/summary/WhatsappMessageStatus'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

const WALLPAPER =
  'bg-bg bg-[radial-gradient(var(--color-primary-soft)_1px,transparent_1px)] bg-size-[16px_16px]'

export default function WhatsappConversation({
  messages,
  leadId,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
  banner = null,
}: {
  messages: LeadWhatsappMessage[]
  leadId: number
  displayName?: string | null
  leadStatus?: string | null
  customerWaId?: string | null
  banner?: ReactNode
}) {
  let latestInbound: LeadWhatsappMessage | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'inbound') {
      latestInbound = messages[i]
      break
    }
  }

  const last = messages.length > 0 ? messages[messages.length - 1] : null

  const thread = messages
    .map((m, i) => {
      const prev = i > 0 ? messages[i - 1] : null
      const newDay = !prev || formatDate(prev.timestamp) !== formatDate(m.timestamp)
      const groupStart = newDay || !prev || prev.direction !== m.direction
      return { m, newDay, groupStart }
    })
    .reverse()

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <WhatsappNewMessageNotifier latestInboundId={latestInbound?.id ?? null} />

      <WhatsappConversationHeader
        displayName={displayName}
        leadStatus={leadStatus}
        customerWaId={customerWaId}
        leadId={leadId}
        lastDirection={last?.direction ?? null}
        lastActivityAt={latestInbound?.timestamp ?? null}
      />

      {banner}

      {messages.length === 0 ? (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center ${WALLPAPER}`}>
          <span className='flex size-14 items-center justify-center rounded-full bg-white'>
            <ChannelIcon channel='whatsapp' className='size-6' />
          </span>
          <p className='mt-3 text-base font-medium text-gray-700'>אין הודעות WhatsApp עדיין</p>
          <p className='mt-1 text-sm text-gray-500'>כשהליד יכתוב, ההודעות יופיעו כאן.</p>
        </div>
      ) : (
        <div
          role='group'
          aria-label='הודעות השיחה'
          className={`flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-4 py-3 ${WALLPAPER}`}
        >
          {thread.map(({ m, newDay, groupStart }) => {
            const inbound = m.direction === 'inbound'
            return (
              <div key={m.id} className={newDay ? '' : groupStart ? 'mt-2' : 'mt-0.5'}>
                {newDay && (
                  <div className='flex justify-center pb-1.5 pt-2.5'>
                    <span
                      suppressHydrationWarning
                      className='rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-gray-500'
                    >
                      {formatDate(m.timestamp)}
                    </span>
                  </div>
                )}
                <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                  <div
                    id={`msg-${m.id}`}
                    className={`max-w-[80%] rounded-2xl border px-3 py-1.5 transition-shadow xl:max-w-[70%] ${
                      inbound
                        ? `border-gray-200 bg-white ${groupStart ? 'rounded-ss-none' : ''}`
                        : m.status === 'failed'
                          ? `border-error-border bg-error-bg ${groupStart ? 'rounded-se-none' : ''}`
                          : `border-success-border bg-success-bg ${groupStart ? 'rounded-se-none' : ''}`
                    }`}
                  >
                    <span className='sr-only'>{inbound ? 'הודעה מהליד' : 'הודעה שנשלחה מהמערכת'}</span>
                    <div className='flex items-end gap-2'>
                      <p className='min-w-0 text-sm leading-normal text-gray-800 whitespace-pre-wrap wrap-break-word'>
                        {m.text || '—'}
                      </p>
                      <span
                        dir='ltr'
                        suppressHydrationWarning
                        className='shrink-0 pb-px text-[10px] leading-none tabular-nums text-gray-500'
                      >
                        {formatTime(m.timestamp)}
                      </span>
                      {!inbound && <WhatsappMessageStatus status={m.status} />}
                    </div>
                    {!inbound && m.status === 'failed' && m.failureText && (
                      <p className='mt-1 text-[11px] leading-snug text-error-text'>{m.failureText}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className='shrink-0 border-t border-gray-100 bg-white px-3 py-2.5'>
        <WhatsappReplyDraft leadId={leadId} />
      </div>
    </div>
  )
}
