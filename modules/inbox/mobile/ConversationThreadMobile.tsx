'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import type { LeadWhatsappMessage } from '@/db/inboxMessages'
import { sendWhatsappReply } from '@/actions/whatsapp/sendWhatsappReply'
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'
import { recordLeadActionEvent } from '@/actions/analytics/recordLeadActionEvent'
import WhatsappComposerPanel, { type WhatsappComposerFacts } from '@/components/inbox/WhatsappComposerPanel'
import { useComposerTypingSignal } from '@/modules/inbox/client/useComposerTypingSignal'
import { buildThreadEntries } from '@/lib/inbox/whatsappThreadView'
import { WhatsappReactionNote } from '@/components/summary/WhatsappReactions'
import MessageBubbleMobile, { MessageActionSheet } from './MessageBubbleMobile'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

/**
 * One conversation, as a messaging screen.
 *
 * NO SECOND MESSAGE MODEL. Messages are `LeadWhatsappMessage` rows loaded by
 * `listConversationMessages`, and sending goes through the EXISTING
 * `sendWhatsappReply` action — which sends first and persists only on a
 * confirmed wamid, so a failed send never leaves a fake bubble.
 *
 * COMPOSER HONESTY. `sendWhatsappReply` can legitimately refuse (no WhatsApp
 * connection, outside Meta's 24-hour customer-service window). Those refusals
 * are surfaced verbatim as a recoverable error with the text preserved in the
 * box — never swallowed, and never faked as a delivered message.
 *
 * LAYOUT. The thread is the only scroll container; the composer is a sibling
 * pinned below it, not a fixed overlay, so the newest message can never sit
 * underneath the input. The tab bar, a sibling of `main`, pays the bottom
 * safe-area inset — the composer must not pay it again.
 */
export default function ConversationThreadMobile({
  conversationId,
  leadId,
  displayName,
  initialMessages,
  composerFacts,
}: {
  conversationId: number
  leadId: number | null
  displayName: string
  initialMessages: LeadWhatsappMessage[]
  composerFacts: WhatsappComposerFacts
}) {
  const router = useRouter()
  const t = useT()
  const [messages, setMessages] = useState(initialMessages)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [sending, setSending] = useState(false)
  const [actionText, setActionText] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Human Presence: the first keystroke parks the WhatsApp agent for this turn.
  const signalTyping = useComposerTypingSignal(conversationId)

  // Land on the newest message inside THIS list. Never scrollIntoView — that
  // walks every overflow ancestor and scrolls the shell `main`, which is what
  // produced the giant blank region under a percentage-height thread.
  useEffect(() => {
    const main = document.getElementById('main-content')
    if (main) main.scrollTop = 0
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  useEffect(() => setMessages(initialMessages), [initialMessages])

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return

    setSending(true)
    setError(null)
    if (leadId == null) return
    const res = await sendWhatsappReply(leadId, body, conversationId)
    setSending(false)

    // Narrow on the literal, not on truthiness — `SendWhatsappReplyResult` is a
    // discriminated union and `res.reason` only exists on the failure arm.
    if (res.ok === false) {
      // Reason codes come from the action; each maps to something the rep can
      // act on rather than a generic failure.
      const reasonKey = Object.hasOwn(REASONS, res.reason) ? REASONS[res.reason] : undefined
      setError(failureTextForCategory(res.category, t.locale) ?? (reasonKey ? t(reasonKey) : t('inbox.mobile.send.generic')))
      return
    }

    setText('')
    recordLeadActionEvent('lead_action_taken', {
      surface: 'mobile',
      action: 'message',
      leadId,
      via: 'inbox',
    }).catch(() => {})
    // The server owns the message list; refresh rather than optimistically
    // inventing a bubble whose id and timestamp we would be guessing.
    startTransition(() => router.refresh())
  }

  return (
    <div data-testid='wa-thread' className='flex min-h-0 flex-1 flex-col overflow-hidden bg-[#ece5dd]'>
      <div
        ref={listRef}
        data-testid='wa-thread-scroller'
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4'
      >
        {messages.length === 0 ? (
          <p className='py-10 text-center text-sm text-gray-500'>{t('inbox.mobile.thread.empty')}</p>
        ) : (
          <ul className='flex flex-col gap-2'>
            {/* Reactions sit on their message or on a line of their own, never as
                bubbles (lib/inbox/whatsappThreadView.ts, shared with desktop). */}
            {buildThreadEntries(messages, t.locale).map((entry) =>
              entry.kind === 'reaction' ? (
                <li key={entry.key}>
                  <WhatsappReactionNote emoji={entry.emoji} byBusiness={entry.byBusiness} alignEnd={entry.direction === 'inbound'} translated />
                </li>
              ) : (
                <MessageBubbleMobile
                  key={entry.key}
                  message={entry.message}
                  reactions={entry.reactions}
                  quote={entry.quote}
                  onOpen={() => {
                    const text = entry.message.text?.trim()
                    if (text) setActionText(text)
                  }}
                />
              ),
            )}
          </ul>
        )}
      </div>

      {leadId != null && (
        <div className='shrink-0 border-t border-[#e0e0e0] bg-[#f0f2f5] px-3 py-2'>
          {error && (
            <p role='alert' className='mb-2 rounded-md bg-error-bg px-3 py-2 text-[13px] text-error-text'>
              {error}
            </p>
          )}

          <WhatsappComposerPanel
            leadId={leadId}
            conversationId={conversationId}
            messages={messages}
            facts={composerFacts}
            readyMessageSurface='sheet'
            translated
            textComposer={
              <form onSubmit={onSend} className='flex items-end gap-2'>
                <label htmlFor='composer' className='sr-only'>
                  {t('inbox.mobile.thread.composerLabel')}
                </label>
                <textarea
                  id='composer'
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    signalTyping()
                    setText(e.target.value)
                  }}
                  placeholder={t('inbox.mobile.thread.composerPlaceholder')}
                  className='max-h-32 min-h-11 flex-1 resize-none rounded-full border-0 bg-white px-4 py-2.5 text-base outline-none focus:ring-2 focus:ring-[#25D366]/40'
                />
                <button
                  type='submit'
                  disabled={!text.trim() || sending || pending}
                  aria-label={t('inbox.mobile.thread.send')}
                  className='flex size-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]'
                >
                  <Icon name={sending ? 'spinner' : 'paper-plane'} type='sol' className={`size-4 bg-white ${sending ? 'animate-spin' : ''}`} />
                </button>
              </form>
            }
          />
        </div>
      )}

      <MessageActionSheet text={actionText} onClose={() => setActionText(null)} />
    </div>
  )
}

/**
 * Every key below is a reason code the backend ACTUALLY returns —
 * `sendWhatsappReply` (invalid-input, empty, too-long, send-failed,
 * persist-failed) and `resolveWhatsappOutboundTarget` (lead-not-found,
 * no-connection, no-recipient). Nothing here is invented; an unmapped code
 * falls through to the generic retry line rather than being guessed at.
 */
const REASONS: Record<string, MessageKey> = {
  'no-connection': 'inbox.mobile.send.noConnection',
  'no-recipient': 'inbox.mobile.send.noRecipient',
  'lead-not-found': 'inbox.mobile.send.leadNotFound',
  // The same sentences the composer's own window / health states use.
  'window-closed': 'inbox.serviceWindow.closedTitle',
  'window-unknown': 'inbox.serviceWindow.unknown',
  'health-blocked': 'inbox.health.restricted.title',
  'leadless': 'inbox.mobile.send.leadless',
  'send-failed': 'inbox.mobile.send.sendFailed',
  // The send SUCCEEDED; only the local copy failed to save. Saying "try again"
  // here would make the rep send the customer a duplicate.
  'persist-failed': 'inbox.mobile.send.persistFailed',
  'too-long': 'inbox.mobile.send.tooLong',
  'invalid-input': 'inbox.mobile.send.invalidInput',
  empty: 'inbox.mobile.send.empty',
}
