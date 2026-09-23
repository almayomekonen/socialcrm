'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { importMessengerConversations, type MessengerProfileFailure } from '../profileActions'

const FAILURE_COPY: Record<MessengerProfileFailure, string> = {
  not_enabled: 'Messenger אינו זמין בחשבון הזה',
  forbidden: 'רק מנהל יכול לייבא שיחות',
  not_found: 'הדף לא נמצא',
  permission_missing: 'חסרה הרשאה לקריאת השיחות מהדף. חבר מחדש את הדף ונסה שוב.',
  invalid: 'הבקשה אינה תקינה',
  rate_limited: 'פייסבוק מגביל כרגע את קצב הבקשות. נסה שוב בעוד כמה דקות.',
  meta_error: 'פייסבוק לא החזיר את השיחות. נסה שוב.',
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
export default function MessengerImportHistory({ pageId }: { pageId: string }) {
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
        setError(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error)
        return
      }
      if (result.conversations === 0) {
        setDone('לא נמצאו שיחות קודמות בדף.')
        return
      }
      setDone(
        `יובאו ${result.conversations} שיחות (${result.messages} הודעות).` +
          (result.hasMore ? ' יש עוד שיחות בדף — אפשר להריץ שוב.' : ''),
      )
      router.refresh()
    })

  return (
    <div className='grid gap-1.5'>
      <Btn onClick={start} disabled={loading} variant='outline'>
        {loading ? 'מייבא שיחות…' : 'ייבא שיחות קיימות מהדף'}
      </Btn>
      <p className='text-[11px] leading-relaxed text-gray-500'>
        פייסבוק מאפשר לייבא רק את ההודעות האחרונות בכל שיחה (עד 20), ולא את כל ההיסטוריה.
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
