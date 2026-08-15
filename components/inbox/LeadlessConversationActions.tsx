'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Link2, User } from 'lucide-react'
import { useAction } from '@/lib/useAction'
import {
  linkConversationToExistingLead,
  listConversationLeadMatches,
  promoteConversationToLead,
  type ConversationLeadMatch,
} from '@/actions/whatsapp/promoteConversationToLead'
import { markConversationPersonal } from '@/actions/whatsapp/markConversationPersonal'

const QUICK_ACTION_CLS =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50'

export default function LeadlessConversationActions({
  conversationId,
  isPersonal,
}: {
  conversationId: number
  isPersonal: boolean
}) {
  const router = useRouter()
  const { loading, error, setError, run } = useAction()
  const [matches, setMatches] = useState<ConversationLeadMatch[] | null>(null)

  function refresh() {
    router.refresh()
  }

  function onCreate() {
    void run(async () => {
      const res = await promoteConversationToLead(conversationId)
      if (res.ok === false) {
        setError(res.reason === 'quota_exceeded' ? 'הגעת למכסת הלידים' : 'לא הצלחנו ליצור ליד')
        return
      }
      refresh()
    })
  }

  function onLinkClick() {
    void run(async () => {
      const listed = await listConversationLeadMatches(conversationId)
      if (listed.ok === false) {
        setError('השיחה לא נמצאה')
        return
      }
      if (listed.matches.length === 0) {
        setError('אין ליד עם אותו מספר. אפשר ליצור ליד חדש.')
        return
      }
      if (listed.matches.length === 1) {
        const res = await linkConversationToExistingLead(conversationId, listed.matches[0].id)
        if (res.ok === false) {
          setError('לא הצלחנו לקשר לליד')
          return
        }
        refresh()
        return
      }
      setMatches(listed.matches)
    })
  }

  function onPick(leadId: number) {
    void run(async () => {
      const res = await linkConversationToExistingLead(conversationId, leadId)
      if (res.ok === false) {
        setError('לא הצלחנו לקשר לליד')
        return
      }
      setMatches(null)
      refresh()
    })
  }

  function onPersonal() {
    void run(async () => {
      const res = await markConversationPersonal(conversationId)
      if (res.ok === false) {
        setError('לא הצלחנו לסמן כאישי')
        return
      }
      refresh()
    })
  }

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      <button type='button' className={QUICK_ACTION_CLS} disabled={loading} onClick={onCreate}>
        <UserPlus aria-hidden className='size-3.5' />
        + צור ליד
      </button>
      <button type='button' className={QUICK_ACTION_CLS} disabled={loading} onClick={onLinkClick}>
        <Link2 aria-hidden className='size-3.5' />
        קשר לליד קיים
      </button>
      {!isPersonal && (
        <button type='button' className={QUICK_ACTION_CLS} disabled={loading} onClick={onPersonal}>
          <User aria-hidden className='size-3.5' />
          סמן כאישי
        </button>
      )}
      {error && (
        <span role='alert' className='text-xs text-error-text'>
          {error}
        </span>
      )}
      {matches && matches.length > 1 && (
        <div className='flex w-full flex-wrap items-center gap-1.5'>
          {matches.map((m) => (
            <button
              key={m.id}
              type='button'
              className={QUICK_ACTION_CLS}
              disabled={loading}
              onClick={() => onPick(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
