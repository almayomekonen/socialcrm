import type { ReactNode } from 'react'
import Link from 'next/link'
import { Contact, Phone } from 'lucide-react'
import { formatDate, formatTime } from '@/lib/dates'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'
import WhatsappNewMessageNotifier from '@/components/summary/WhatsappNewMessageNotifier'
import LeadAvatar from '@/components/ui/lead-avatar'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'

// Soft chat wallpaper: app-background tint with a faint dot grid from the
// existing brand-soft token — no assets, no new hues.
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
  const attention =
    last === null
      ? null
      : last.direction === 'inbound'
        ? { label: 'דורש מענה', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' }
        : { label: 'הנציג השיב לאחרונה', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' }

  // Chronological flags, then reversed for the column-reverse scroller (which
  // keeps the newest message pinned to the bottom with zero JS).
  const thread = messages
    .map((m, i) => {
      const prev = i > 0 ? messages[i - 1] : null
      const newDay = !prev || formatDate(prev.timestamp) !== formatDate(m.timestamp)
      const groupStart = newDay || !prev || prev.direction !== m.direction
      return { m, newDay, groupStart }
    })
    .reverse()

  const quickActionCls =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <WhatsappNewMessageNotifier latestInboundId={latestInbound?.id ?? null} />

      <div className='flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-100 bg-white px-4 py-2.5'>
        {displayName ? (
          <div className='flex min-w-0 items-center gap-3'>
            <LeadAvatar name={displayName} size='lg' />
            <div className='min-w-0'>
              <div className='flex min-w-0 items-center gap-2'>
                <h1 className='truncate text-base font-bold text-gray-900'>{displayName}</h1>
                {leadStatus && (
                  <span className='shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600'>
                    {leadStatus}
                  </span>
                )}
              </div>
              <div className='mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500'>
                <ChannelIcon channel='whatsapp' />
                <span className='truncate' suppressHydrationWarning>
                  WhatsApp
                  {customerWaId ? ' · ' : ''}
                  {customerWaId && (
                    <span dir='ltr' className='tabular-nums'>
                      +{customerWaId}
                    </span>
                  )}
                  {latestInbound ? ` · פעילות אחרונה ${formatDate(latestInbound.timestamp)}` : ''}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className='flex items-center gap-2'>
            <ChannelIcon channel='whatsapp' className='size-5' />
            <h1 className='text-base font-bold text-gray-900'>שיחת WhatsApp</h1>
          </div>
        )}

        <div className='flex items-center gap-1.5'>
          {attention && (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${attention.bg} ${attention.text} ${attention.border}`}
            >
              <span className={`size-1.5 rounded-full ${attention.dot}`} />
              {attention.label}
            </span>
          )}
          {displayName && customerWaId && (
            <a href={`tel:+${customerWaId}`} className={quickActionCls}>
              <Phone aria-hidden className='size-3.5' />
              התקשר
            </a>
          )}
          {displayName && (
            <Link href={`/clients/${leadId}/summary`} className={quickActionCls}>
              <Contact aria-hidden className='size-3.5' />
              כרטיס ליד
            </Link>
          )}
        </div>
      </div>

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
        <div className={`flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-4 py-3 ${WALLPAPER}`}>
          {thread.map(({ m, newDay, groupStart }) => {
            const inbound = m.direction === 'inbound'
            return (
              <div key={m.id} className={newDay ? '' : groupStart ? 'mt-2' : 'mt-[2px]'}>
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
                    </div>
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
