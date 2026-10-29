'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip, Send } from 'lucide-react'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { MESSENGER_TEXT_MAX, type MessengerSendFailure } from '@/lib/facebook/messenger/rules'
import { sendMessengerReply, sendMessengerSavedReply } from '../actions'
import { useAttachmentUpload } from '../useAttachmentUpload'
import { useMessengerDraft, useMessengerTyping } from '../useComposerState'
import MessengerAttachmentTray from './MessengerAttachmentTray'
import MessengerSavedReplyPicker from './MessengerSavedReplyPicker'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

const FAILURE_KEYS: Record<MessengerSendFailure, MessageKey> = {
  not_enabled: 'inbox.messenger.failure.not_enabled',
  not_found: 'inbox.messenger.failure.not_found',
  empty: 'inbox.messenger.failure.empty',
  too_long: 'inbox.messenger.failure.too_long',
  invalid_file: 'inbox.messenger.failure.invalid_file',
  window_closed: 'inbox.messenger.failure.window_closed',
  permission_missing: 'inbox.messenger.failure.permission_missing',
  reconnect_required: 'inbox.messenger.failure.reconnect_required',
  recipient_unavailable: 'inbox.messenger.failure.recipient_unavailable',
  rate_limited: 'inbox.messenger.failure.rate_limited',
  meta_error: 'inbox.messenger.failure.meta_error',
}

/**
 * Reply — text, a file, or a file with a caption — inside the 24-hour window.
 *
 * THE DRAFT IS NEVER LOST. It is held per conversation in sessionStorage and
 * cleared only once Meta has accepted the message. A failed send leaves the text
 * exactly where it was, so the rep retries instead of retyping.
 *
 * NO OPTIMISTIC BUBBLE. A Messenger message exists once Meta returns its id; the
 * server records it and the refresh shows it. An optimistic bubble would have to
 * be rolled back on failure, and a message that appears and then vanishes is
 * worse than one that appears a moment later.
 *
 * The window decision is made on the SERVER (page render, and again in the
 * action) and passed in. This component never reads the clock.
 *
 * `locale` is the page's interface language (Hebrew by default: the phone
 * branch). A failure's `detail` is the server's own sentence (structured-reply
 * validation, Hebrew only) and is shown as it arrives, as before.
 */
export default function MessengerComposer({
  conversationId,
  windowOpen,
  windowHint,
  savedReplies = [],
  locale = 'he',
}: {
  conversationId: number
  windowOpen: boolean
  windowHint: string | null
  /** This agency's snippets. Empty ⇒ the picker does not render at all. */
  savedReplies?: MessengerSavedReply[]
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const failureCopy = (reason: MessengerSendFailure) => t(FAILURE_KEYS[reason] ?? FAILURE_KEYS.meta_error)
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { draft, setDraft, clearDraft } = useMessengerDraft(conversationId)
  const { typing, stopTyping } = useMessengerTyping(conversationId)
  const upload = useAttachmentUpload(conversationId, locale)
  const { loading, run, accessDenied } = useAction()

  if (accessDenied) {
    return (
      <SubscriptionExpiredState
        mode='inline'
        source='messenger_reply'
        feature={t('inbox.locked.composer')}
        translated={locale !== 'he'}
      />
    )
  }

  if (!windowOpen) {
    return (
      <div role='status' className='rounded-md border border-amber-300 bg-amber-50 p-3'>
        <p className='text-sm font-medium text-amber-800'>{t('inbox.messenger.window.closedTitle')}</p>
        <p className='mt-1 text-sm text-amber-700'>{t('inbox.messenger.window.closedBody')}</p>
      </div>
    )
  }

  const busy = loading || upload.state.phase === 'uploading' || upload.state.phase === 'sending'
  const canSend = (draft.trim().length > 0 || file !== null) && !busy

  const clearFile = () => {
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  /** A structured reply goes as-is; its buttons cannot survive a textarea. */
  const sendSaved = (reply: MessengerSavedReply) => {
    setFailure(null)
    stopTyping()
    void run(async () => {
      const result = await sendMessengerSavedReply(conversationId, reply.id)
      if ('reason' in result) {
        setFailure(result.detail ?? failureCopy(result.reason))
        return
      }
      toast('success', t('inbox.messenger.composer.savedSent'))
      router.refresh()
    })
  }

  const send = () => {
    setFailure(null)
    stopTyping()

    // A file (with its caption, sent as a second message) goes through the
    // upload route, which is the only path that can report real progress.
    if (file) {
      void upload.upload(file, draft.trim()).then((ok) => {
        if (!ok) return
        clearFile()
        clearDraft()
        toast('success', t('inbox.messenger.composer.fileSent'))
        router.refresh()
      })
      return
    }

    void run(async () => {
      if (!draft.trim()) return
      const result = await sendMessengerReply(conversationId, draft)
      if ('reason' in result) {
        setFailure(result.detail ?? failureCopy(result.reason))
        return
      }
      clearDraft()
      toast('success', t('inbox.messenger.composer.sent'))
      router.refresh()
    })
  }

  const error = failure ?? (upload.state.phase === 'error' ? upload.state.message : null)

  return (
    <div>
      {file && (
        <MessengerAttachmentTray
          file={file}
          upload={upload.state}
          locale={locale}
          onRemove={() => {
            upload.cancel()
            clearFile()
            setFailure(null)
          }}
        />
      )}

      <div className='flex items-end gap-1.5'>
        <input
          ref={fileInput}
          type='file'
          className='sr-only'
          onChange={(e) => {
            upload.reset()
            setFailure(null)
            setFile(e.target.files?.[0] ?? null)
          }}
        />
        <MessengerSavedReplyPicker
          replies={savedReplies}
          disabled={busy}
          // Plain text becomes a starting point the rep edits; the draft is
          // replaced rather than appended, because a snippet is a whole answer.
          onInsert={(reply) => setDraft(reply.body.slice(0, MESSENGER_TEXT_MAX))}
          onSend={sendSaved}
          locale={locale}
        />
        <button
          type='button'
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-label={t('inbox.messenger.composer.attach')}
          title={t('inbox.messenger.composer.attach')}
          className='flex size-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50'
        >
          <Paperclip aria-hidden className='size-4' />
        </button>

        <label htmlFor='messenger-reply' className='sr-only'>
          {file ? t('inbox.messenger.composer.captionLabel') : t('inbox.messenger.composer.label')}
        </label>
        <textarea
          id='messenger-reply'
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, MESSENGER_TEXT_MAX))
            typing()
          }}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (canSend) send()
            }
          }}
          rows={1}
          disabled={busy}
          placeholder={file ? t('inbox.messenger.composer.captionPlaceholder') : t('inbox.messenger.composer.placeholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'messenger-reply-error' : undefined}
          className='max-h-32 min-w-0 flex-1 resize-none field-sizing-content rounded-3xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50'
        />
        <button
          type='button'
          onClick={send}
          disabled={!canSend}
          aria-label={busy ? t('inbox.messenger.composer.sending') : t('inbox.messenger.composer.send')}
          title={canSend ? t('inbox.messenger.composer.send') : t('inbox.messenger.composer.sendHint')}
          className='flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50'
        >
          <Send aria-hidden className={`size-4 -scale-x-100 ${busy ? 'opacity-60' : ''}`} />
        </button>
      </div>

      {error && (
        <p id='messenger-reply-error' role='alert' className='mt-1 text-xs text-error-text'>
          {error}
        </p>
      )}
      {!error && windowHint && <p className='mt-1 ps-2 text-[11px] text-gray-500'>{windowHint}</p>}
    </div>
  )
}
