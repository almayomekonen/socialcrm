'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreVertical, Trash2 } from 'lucide-react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import { deleteConversation } from '@/modules/inbox/actions'

/**
 * "⋮ → מחק שיחה" for a WhatsApp conversation, reused in the Inbox list row and
 * the open-chat header. Deletes the SocialCRM copy of the thread only — never
 * the Lead, the number, or anything on Meta's side (see the delete action).
 *
 * Correctness over optimism: the UI is mutated ONLY after the server confirms
 * success, so there is no optimistic state to roll back. On failure the row
 * stays and an error toast is shown.
 *
 * Must be rendered inside the InboxStoreProvider (both call sites are).
 */
export default function DeleteConversationMenu({
  conversationId,
  size = 'sm',
}: {
  conversationId: number
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { removeConversation } = useInboxStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function onConfirm() {
    // ConfirmPop owns the in-flight (busy) state and awaits this. On any failure
    // we surface an error and return WITHOUT mutating the UI — the dialog stays
    // open so the user can retry or cancel, and the conversation stays visible.
    let res: { ok: boolean; deleted: boolean }
    try {
      res = await deleteConversation(conversationId)
    } catch {
      toast('error', 'מחיקת השיחה נכשלה. נסה שוב.')
      return
    }
    if (!res.ok) {
      toast('error', 'מחיקת השיחה נכשלה. נסה שוב.')
      return
    }

    // Success (a already-gone conversation counts as success — idempotent).
    // Remove locally for an instant update, close the thread if it was the open
    // one, then reconcile counts/server truth via a soft refresh (no full reload).
    setConfirmOpen(false)
    removeConversation(conversationId)
    const openParam = searchParams.get('conversation')
    if (openParam && Number(openParam) === conversationId) {
      router.replace('/inbox')
    }
    router.refresh()
    toast('success', 'השיחה נמחקה')
  }

  const btnSize = size === 'md' ? 'size-8' : 'size-7'
  const iconSize = size === 'md' ? 'size-4' : 'size-3.5'

  return (
    <div ref={wrapRef} className='relative shrink-0'>
      <button
        type='button'
        aria-label='פעולות שיחה'
        aria-haspopup='menu'
        aria-expanded={menuOpen}
        className={`inline-flex ${btnSize} items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
        onClick={(e) => {
          // The list row is a <Link>; keep the ⋮ from triggering navigation.
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen((v) => !v)
        }}
      >
        <MoreVertical aria-hidden className={iconSize} />
      </button>

      {menuOpen && (
        <div
          role='menu'
          className='absolute end-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg'
        >
          <button
            type='button'
            role='menuitem'
            className='flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-red-600 transition-colors hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none'
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenuOpen(false)
              setConfirmOpen(true)
            }}
          >
            <Trash2 aria-hidden className='size-3.5' />
            מחק שיחה
          </button>
        </div>
      )}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
        msg={'מחיקת השיחה?\n\nהשיחה וההודעות שלה יימחקו מ-SocialCRM. הפעולה לא תמחק את איש הקשר או את הליד ב-CRM.'}
        confirmLbl='מחק שיחה'
        cancelLbl='בטל'
        destructive
      />
    </div>
  )
}
