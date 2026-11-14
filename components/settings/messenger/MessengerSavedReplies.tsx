'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import { EMPTY, draftPayload, toDraft, type Draft } from './savedReplyDraft'
import SavedReplyList from './SavedReplyList'
import SavedReplyForm from './SavedReplyForm'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { savedReplyDetail } from './savedReplyDraft'
import { createSavedReply, deleteSavedReply, updateSavedReply, type SavedReplyFailure } from '@/modules/messenger/savedReplyActions'

const FAILURE_COPY: Record<SavedReplyFailure, MessageKey> = {
  not_enabled: 'settings.messenger.replies.failure.not_enabled',
  forbidden: 'settings.messenger.replies.failure.forbidden',
  not_found: 'settings.messenger.replies.failure.not_found',
  title_taken: 'settings.messenger.replies.failure.title_taken',
  empty: 'settings.messenger.replies.failure.empty',
  too_many: 'settings.messenger.replies.failure.too_many',
  invalid: 'settings.messenger.replies.failure.invalid',
}

/**
 * Manage the agency's Messenger saved replies.
 *
 * WHY BUTTONS ARE LINK-ONLY HERE. A `postback` button sends a payload back into
 * the conversation as an event — useful, but it needs something on the other
 * end to mean anything, and SocialCRM has no automation bound to custom
 * payloads yet. Offering one would be a control that appears to do something and
 * does not. Quick replies cover the same ground honestly: the customer's tap
 * arrives as their reply, in words, which a rep can act on. `web_url` buttons
 * genuinely work with no backend at all, so those are offered.
 *
 * ATTACHMENTS ARE A URL, not an upload: Meta's reusable attachment_id expires
 * after 90 days, which would make a saved reply stop working three months later
 * with no visible cause. A URL the business controls does not expire.
 *
 * Admin-only; the server enforces it independently of whether this renders.
 */
export default function MessengerSavedReplies({ initial }: { initial: MessengerSavedReply[] }) {
  const t = useT()
  const [replies, setReplies] = useState(initial)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { loading, run } = useAction()

  const fail = (reason: SavedReplyFailure, detail?: string) => setError(detail ? savedReplyDetail(detail, t) : t(FAILURE_COPY[reason] ?? FAILURE_COPY.invalid))

  const save = () => {
    if (!draft) return
    run(async () => {
      setError(null)
      const payload = draftPayload(draft)
      const result = draft.id ? await updateSavedReply(draft.id, payload) : await createSavedReply(payload)
      if ('reason' in result) {
        fail(result.reason, result.detail)
        return
      }
      setReplies((prev) => {
        const without = prev.filter((r) => r.id !== result.reply.id)
        return [...without, result.reply].sort((a, b) => a.title.localeCompare(b.title, 'he'))
      })
      setDraft(null)
      toast('success', t('settings.messenger.replies.saved'))
    })
  }

  const remove = (reply: MessengerSavedReply) => {
    if (!confirm(t('settings.messenger.replies.deleteConfirm', { title: reply.title }))) return
    run(async () => {
      setError(null)
      const result = await deleteSavedReply(reply.id)
      if (!result.ok) {
        fail(result.reason ?? 'not_found')
        return
      }
      setReplies((prev) => prev.filter((r) => r.id !== reply.id))
      toast('success', t('settings.messenger.replies.deleted'))
    })
  }

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <div className='grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4'>
      <p className='text-xs leading-relaxed text-gray-500'>
        {t('settings.messenger.replies.intro')}
      </p>

      {replies.length > 0 && <SavedReplyList replies={replies} loading={loading} onEdit={(reply) => setDraft(toDraft(reply))} onRemove={remove} />}

      {!draft && (
        <div>
          <Btn variant='outline' icon='plus' lbl={t('settings.messenger.replies.add')} onClick={() => setDraft({ ...EMPTY })} disabled={loading} />
        </div>
      )}

      {draft && (
        <SavedReplyForm
          draft={draft}
          setField={setField}
          loading={loading}
          error={error}
          onSave={save}
          onCancel={() => {
            setDraft(null)
            setError(null)
          }}
        />
      )}

      {!draft && error && (
        <p role='alert' className='text-sm text-error-text'>
          {error}
        </p>
      )}
    </div>
  )
}
