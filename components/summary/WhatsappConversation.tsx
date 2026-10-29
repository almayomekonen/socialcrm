'use client'

import type { ReactNode } from 'react'
import { formatTime } from '@/lib/dates'
import { formatLeadDate } from '@/lib/leads/leadDate'
import { useT } from '@/lib/i18n/I18nProvider'
import { customerTextAttrs } from '@/lib/i18n/config'
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { lastCountedDirection } from '@/lib/inbox/humanReply'
import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'
import WhatsappNewMessageNotifier from '@/components/summary/WhatsappNewMessageNotifier'
import WhatsappConversationHeader from '@/components/summary/WhatsappConversationHeader'
import WhatsappMessageStatus from '@/components/summary/WhatsappMessageStatus'
import LinkifiedText from '@/components/summary/LinkifiedText'
import WhatsappComposerPanel, { type WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'
import ChannelIcon from '@/modules/inbox/components/ChannelIcon'
import WhatsappAttachment from '@/components/summary/WhatsappAttachment'
import { bubbleMediaLayout, buildThreadEntries, entryMeta, messageBody } from '@/lib/inbox/whatsappThreadView'
import WhatsappQuoteStrip from '@/components/summary/WhatsappQuoteStrip'
import { WhatsappReactionChips, WhatsappReactionNote } from '@/components/summary/WhatsappReactions'

const WALLPAPER =
  'bg-bg bg-[radial-gradient(var(--color-primary-soft)_1px,transparent_1px)] bg-size-[16px_16px]'

export default function WhatsappConversation({
  messages,
  leadId,
  conversationId = null,
  isPersonal = false,
  showDelete = false,
  displayName = null,
  leadStatus = null,
  customerWaId = null,
  banner = null,
  composerFacts = null,
}: {
  messages: LeadWhatsappMessage[]
  leadId: number | null
  conversationId?: number | null
  isPersonal?: boolean
  showDelete?: boolean
  displayName?: string | null
  leadStatus?: string | null
  customerWaId?: string | null
  banner?: ReactNode
  composerFacts?: WhatsappComposerFacts | null
}) {
  const t = useT()
  const day = (at: string) => formatLeadDate(t.locale, at)
  let latestInbound: LeadWhatsappMessage | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'inbound') {
      latestInbound = messages[i]
      break
    }
  }


  // Reactions sit on their message or on a line of their own, never as bubbles
  // (lib/inbox/whatsappThreadView.ts, shared with the mobile thread).
  const entries = buildThreadEntries(messages, t.locale)
  const thread = entries
    .map((entry, i) => {
      const { timestamp, direction } = entryMeta(entry)
      const prev = i > 0 ? entryMeta(entries[i - 1]) : null
      const newDay = !prev || day(prev.timestamp) !== day(timestamp)
      const groupStart = newDay || !prev || prev.direction !== direction
      return { entry, timestamp, direction, newDay, groupStart }
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
        conversationId={conversationId}
        isPersonal={isPersonal}
        showDelete={showDelete}
        lastDirection={lastCountedDirection(messages)}
        lastActivityAt={latestInbound?.timestamp ?? null}
      />

      {banner}

      {messages.length === 0 ? (
        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center ${WALLPAPER}`}>
          <span className='flex size-14 items-center justify-center rounded-full bg-white'>
            <ChannelIcon channel='whatsapp' className='size-6' />
          </span>
          <p className='mt-3 text-base font-medium text-gray-700'>{t('inbox.conversation.emptyTitle')}</p>
          <p className='mt-1 text-sm text-gray-500'>
            {leadId != null ? t('inbox.conversation.emptyLead') : t('inbox.conversation.emptyContact')}
          </p>
        </div>
      ) : (
        <div
          role='group'
          aria-label={t('inbox.conversation.messages')}
          className={`flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-4 py-3 ${WALLPAPER}`}
        >
          {thread.map(({ entry, timestamp, direction, newDay, groupStart }) => {
            const inbound = direction === 'inbound'
            const daySeparator = newDay && (
              <div className='flex justify-center pb-1.5 pt-2.5'>
                <span
                  suppressHydrationWarning
                  className='rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-gray-500'
                >
                  {day(timestamp)}
                </span>
              </div>
            )
            if (entry.kind === 'reaction') {
              return (
                <div key={entry.key} className={newDay ? '' : 'mt-1'}>
                  {daySeparator}
                  <WhatsappReactionNote emoji={entry.emoji} byBusiness={entry.byBusiness} alignEnd={!inbound} translated />
                </div>
              )
            }
            const m = entry.message
            const body = messageBody(m, t.locale)
            // A photo IS the bubble: the picture fills it and carries the time in
            // its corner, so the bubble drops its padding and its own time row.
            const { photoBubble, mediaCarriesTime } = bubbleMediaLayout(m)
            return (
              <div key={entry.key} className={newDay ? '' : groupStart ? 'mt-2' : 'mt-0.5'}>
                {daySeparator}
                <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                  <div
                    id={`msg-${m.id}`}
                    className={`max-w-[80%] rounded-2xl border transition-shadow xl:max-w-[70%] ${
                      photoBubble ? 'overflow-hidden p-1' : 'px-3 py-1.5'
                    } ${
                      inbound
                        ? `border-gray-200 bg-white ${groupStart ? 'rounded-ss-none' : ''}`
                        : m.status === 'failed'
                          ? `border-error-border bg-error-bg ${groupStart ? 'rounded-se-none' : ''}`
                          : `border-success-border bg-success-bg ${groupStart ? 'rounded-se-none' : ''}`
                    }`}
                  >
                    <span className='sr-only'>{inbound ? t('inbox.conversation.inbound') : t('inbox.conversation.outbound')}</span>
                    {entry.quote && <WhatsappQuoteStrip quote={entry.quote} translated />}
                    {m.attachment && (
                      <WhatsappAttachment
                        messageId={m.id}
                        attachment={m.attachment}
                        timestampLabel={formatTime(m.timestamp)}
                        translated
                      />
                    )}
                    <div className='flex items-end gap-2'>
                      {/* The message itself: stored text, never translated; in a translated pane it keeps its own direction. */}
                      <p
                        className='min-w-0 text-sm leading-normal text-gray-800 whitespace-pre-wrap wrap-break-word'
                        {...customerTextAttrs(t.locale)}
                      >
                        <LinkifiedText>{body ?? '—'}</LinkifiedText>
                      </p>
                      {/* A photo and a voice note carry the time inside the media itself,
                          so repeating it under the bubble would show it twice. */}
                      {!mediaCarriesTime && (
                        <span
                          dir='ltr'
                          suppressHydrationWarning
                          className='shrink-0 pb-px text-[10px] leading-none tabular-nums text-gray-500'
                        >
                          {formatTime(m.timestamp)}
                        </span>
                      )}
                      {!inbound && <WhatsappMessageStatus status={m.status} failureCategory={m.failureCategory} />}
                    </div>
                    {!inbound && m.status === 'failed' && m.failureText && (
                      // By the persisted CATEGORY (the server's `failureText` is the same copy in Hebrew).
                      <p className='mt-1 text-[11px] leading-snug text-error-text'>
                        {m.failureCategory ? failureTextForCategory(m.failureCategory, t.locale) : m.failureText}
                      </p>
                    )}
                  </div>
                </div>
                <WhatsappReactionChips reactions={entry.reactions} alignEnd={!inbound} translated />
              </div>
            )
          })}
        </div>
      )}

      {leadId != null && leadId > 0 && (
        <div className='shrink-0 border-t border-gray-100 bg-white px-3 py-2.5'>
          {composerFacts ? (
            <WhatsappComposerPanel
              leadId={leadId}
              conversationId={conversationId}
              messages={messages}
              facts={composerFacts}
              textComposer={<WhatsappReplyDraft leadId={leadId} conversationId={conversationId} />}
              translated
            />
          ) : (
            <WhatsappReplyDraft leadId={leadId} conversationId={conversationId} />
          )}
        </div>
      )}
    </div>
  )
}
