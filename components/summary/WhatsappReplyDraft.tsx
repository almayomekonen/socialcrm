'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Send, Smile, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmojiPicker from '@/components/ui/emoji-picker'
import { copyToClipboard } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { generateWhatsappReplyDraft } from '@/actions/ai/whatsappReplyDraft'
import { sendWhatsappReply } from '@/actions/whatsapp/sendWhatsappReply'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'
import { useComposerTypingSignal } from '@/modules/inbox/client/useComposerTypingSignal'
import { useT } from '@/lib/i18n/I18nProvider'

const MAX_CHARS = 4096

export default function WhatsappReplyDraft({
  leadId,
  conversationId = null,
}: {
  leadId: number
  conversationId?: number | null
}) {
  const t = useT()
  const expired = useAccessDenied()
  const router = useRouter()
  const [draft, setDraft] = useState('')
  // Chrome only: the draft itself (what the rep types) is never touched by the language.
  const [error, setError] = useState<'failed' | 'limit' | null>(null)
  const [pending, startTransition] = useTransition()
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  // Human Presence: the first keystroke parks the WhatsApp agent for this turn.
  const signalTyping = useComposerTypingSignal(conversationId)
  // Set synchronously: `pending` only disables the button after a render.
  const generatingRef = useRef(false)

  const hasDraft = draft.trim().length > 0
  const busy = pending || sending

  // Insert at the caret (or replace the selection), keep writing where the emoji
  // landed. Stable identity (with the functional setDraft) so the memoized
  // EmojiPicker never re-renders on keystrokes.
  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? null
    const end = el?.selectionEnd ?? null
    setDraft((d) => {
      const s = start ?? d.length
      const e = end ?? d.length
  return (d.slice(0, s) + emoji + d.slice(e)).slice(0, MAX_CHARS)
    })
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      if (!el) return
      const caret = Math.min((start ?? el.value.length) + emoji.length, el.value.length)
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }, [])

  const closeEmoji = useCallback((reason: 'escape' | 'outside') => {
    setEmojiOpen(false)
    if (reason === 'escape') emojiBtnRef.current?.focus()
  }, [])

  /**
   * Two prohibited operations live in this component — a PAID AI draft and a
   * real WhatsApp SEND. Both are entitlement-guarded on the server, but the
   * guard's refusal surfaced here as "לא ניתן היה לנסח טיוטה כרגע. נסה שוב."
   * Gating up front means the paid call is never attempted just to discover the
   * subscription lapsed, and no message can be sent.
   */
  const generate = () => {
    if (generatingRef.current) return
    generatingRef.current = true
    setError(null)
    // One id per press: the server counts it once and will not run it twice.
    const requestId = crypto.randomUUID()
    startTransition(async () => {
      try {
        const res = await generateWhatsappReplyDraft(leadId, requestId)
        if ('message' in res) setDraft(res.message.slice(0, MAX_CHARS))
        else if (res.reason === 'ai-credits-exhausted') setError('limit')
        else if (res.reason !== 'duplicate-request') setError('failed')
      } finally {
        generatingRef.current = false
      }
    })
  }

  const handleCopy = async () => {
    const ok = await copyToClipboard(draft)
    if (ok) toast('success', t('inbox.draft.copied'))
    else toast('error', t('inbox.draft.copyFailed'))
  }

  const handleSend = async () => {
    if (!hasDraft || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await sendWhatsappReply(leadId, draft, conversationId)
      if (res.ok === true) {
        setDraft('')
        // HTTP 200 from the Cloud API is an ACCEPT, not a delivery. Only a
        // `delivered` webhook may imply the message arrived — see
        // WhatsappMessageStatus.
        toast('success', t('inbox.draft.sent'))
        router.refresh()
      } else {
        toast('error', failureTextForCategory(res.category, t.locale) ?? t('inbox.draft.sendFailed'))
      }
    } catch {
      toast('error', t('inbox.draft.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  if (expired) {
    return <SubscriptionExpiredState mode='inline' source='whatsapp_reply_draft' feature={t('inbox.draft.expired')} translated />
  }

  return (
    <div>
      <div className='relative flex items-end gap-1.5'>
        <EmojiPicker open={emojiOpen} onClose={closeEmoji} onPick={insertEmoji} triggerRef={emojiBtnRef} translated />

        <button
          ref={emojiBtnRef}
          type='button'
          onClick={() => setEmojiOpen((v) => !v)}
          disabled={sending}
          aria-label={t('inbox.draft.emoji')}
          aria-haspopup='dialog'
          aria-expanded={emojiOpen}
          title={t('inbox.draft.emoji')}
          className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            emojiOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-500'
          }`}
        >
          <Smile aria-hidden className='size-5' />
        </button>

        <textarea
          ref={textareaRef}
          id='wa-reply-draft'
          value={draft}
          onChange={(e) => {
            signalTyping()
            setDraft(e.target.value.slice(0, MAX_CHARS))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleSend()
            }
          }}
          rows={1}
          disabled={sending}
          placeholder={t('inbox.draft.placeholder')}
          aria-label={t('inbox.draft.label')}
          className='max-h-32 min-w-0 flex-1 resize-none field-sizing-content rounded-3xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50'
        />

        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={generate}
          disabled={busy}
          title={t('inbox.draft.aiTitle')}
          className='shrink-0 gap-1 rounded-full px-3'
        >
          <Sparkles aria-hidden className='size-3.5 text-accent' />
          {pending ? t('inbox.draft.drafting') : 'AI'}
        </Button>

        <button
          type='button'
          onClick={handleCopy}
          disabled={!hasDraft || busy}
          aria-label={t('inbox.draft.copy')}
          title={t('inbox.draft.copy')}
          className='flex size-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        >
          <Copy aria-hidden className='size-4' />
        </button>

        <button
          type='button'
          onClick={handleSend}
          disabled={!hasDraft || busy}
          aria-label={t('inbox.draft.send')}
          title={t('inbox.draft.send')}
          className='flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-white transition-colors hover:bg-success/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/50'
        >
          <Send aria-hidden className='size-4 -scale-x-100' />
        </button>
      </div>

      {/* The counter is guidance, not data — surface it only when the limit is near. */}
      {draft.length >= MAX_CHARS - 500 && (
        <div className='mt-1 ps-10.5'>
          <span className='text-[10px] text-gray-400 tabular-nums'>
            {/* Counts as text: Hebrew stays exactly as before (no digit grouping). */}
            {t('inbox.draft.chars', { count: String(draft.length), max: String(MAX_CHARS) })}
          </span>
        </div>
      )}
      {error && <p className='mt-1 ps-10.5 text-xs text-red-500'>{error === 'limit' ? t('inbox.draft.draftLimit') : t('inbox.draft.draftFailed')}</p>}
    </div>
  )
}
