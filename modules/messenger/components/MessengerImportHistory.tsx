'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { importMessengerConversations, type MessengerProfileFailure } from '../profileActions'
import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

const FAILURE_KEYS: Record<MessengerProfileFailure, MessageKey> = {
  not_enabled: 'inbox.messenger.import.failure.not_enabled',
  forbidden: 'inbox.messenger.import.failure.forbidden',
  not_found: 'inbox.messenger.import.failure.not_found',
  permission_missing: 'inbox.messenger.import.failure.permission_missing',
  invalid: 'inbox.messenger.import.failure.invalid',
  rate_limited: 'inbox.messenger.import.failure.rate_limited',
  meta_error: 'inbox.messenger.import.failure.meta_error',
}

/**
 * Bring in the conversations the Page already had.
 *
 * WHY IT IS A BUTTON AND NOT AUTOMATIC. It is a burst of Graph calls against
 * the Page's shared rate limit — the same limit Lead Ads intake uses — so it
 * runs when someone asks, not on connect and not on a timer.
 *
 * THE COPY DOES NOT OVERPROMISE. Meta returns details for only the 20 most
 * recent messages per conversation, so the button says "recent conversations"
 * before it runs and reports what actually arrived afterwards. Telling a rep
 * their history is here and then showing them twenty messages is the kind of
 * small lie that makes someone stop believing the rest of the screen.
 */
export default function MessengerImportHistory({ pageId, locale = 'he' }: { pageId: string; locale?: UiLocale }) {
  const t = translatorFor(locale)
  const router = useRouter()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { loading, run } = useAction()

  const start = () =>
    run(async () => {
      setError(null)
      setDone(null)
      const result = await importMessengerConversations(pageId)
      if ('reason' in result) {
        setError(t(FAILURE_KEYS[result.reason] ?? FAILURE_KEYS.meta_error))
        return
      }
      if (result.conversations === 0) {
        setDone(t('inbox.messenger.import.none'))
        return
      }
      // Counts as text, so Hebrew reads exactly as before (no digit grouping); `count` picks the plural.
      const counts = {
        count: result.conversations,
        conversations: String(result.conversations),
        messages: String(result.messages),
      }
      setDone(result.hasMore ? t('inbox.messenger.import.doneMore', counts) : t('inbox.messenger.import.done', counts))
      router.refresh()
    })

  return (
    <div className='grid gap-1.5'>
      <Btn
        lbl={loading ? t('inbox.messenger.import.running') : t('inbox.messenger.import.start')}
        onClick={start}
        disabled={loading}
        variant='outline'
      />
      <p className='text-[11px] leading-relaxed text-gray-500'>
        {t('inbox.messenger.import.note')}
      </p>
      {done && (
        <p role='status' className='text-xs text-gray-600'>
          {done}
        </p>
      )}
      {error && (
        <p role='alert' className='text-xs text-error-text'>
          {error}
        </p>
      )}
    </div>
  )
}
