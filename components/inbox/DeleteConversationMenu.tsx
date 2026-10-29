'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoreVertical, Trash2 } from 'lucide-react'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { toast } from '@/lib/toast'
import { useInboxStore } from '@/modules/inbox/client/inboxStore'
import { deleteConversation } from '@/modules/inbox/actions'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

const MENU_WIDTH = 176 // min-w-[10rem] (160px) + slack, for viewport clamping

/**
 * "⋮ → מחק שיחה" for a WhatsApp conversation, reused in the Inbox list row and
 * the open-chat header. Deletes the SocialCRM copy of the thread only — never
 * the Lead, the number, or anything on Meta's side (see the delete action).
 *
 * The dropdown is rendered in a portal with fixed positioning so it escapes the
 * conversation list's `overflow-y-auto` clip and sibling-row stacking — the
 * earlier in-flow absolute menu was covered by the next row. Correctness over
 * optimism: the UI is mutated only after the server confirms success.
 *
 * `revealOnHover` fades the trigger in only on row hover/focus (list rows);
 * the open-chat header shows it persistently.
 *
 * Must be rendered inside the InboxStoreProvider (both call sites are).
 */
export default function DeleteConversationMenu({
  conversationId,
  size = 'sm',
  revealOnHover = false,
}: {
  conversationId: number
  size?: 'sm' | 'md'
  revealOnHover?: boolean
}) {
  const t = useT()
  const region = useRegionAttrs()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { removeConversation } = useInboxStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8))
      setPos({ top: r.bottom + 4, left })
    }
    setMenuOpen(true)
  }

  // Dismiss on outside click, Escape, or scroll/resize (a fixed menu would
  // otherwise detach from its trigger when the list scrolls).
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    function onReflow() {
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
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
      toast('error', t('inbox.menu.deleteFailed'))
      return
    }
    if (!res.ok) {
      toast('error', t('inbox.menu.deleteFailed'))
      return
    }

    // Success (an already-gone conversation counts as success — idempotent).
    // Remove locally for an instant update, close the thread if it was the open
    // one, then reconcile counts/server truth via a soft refresh (no full reload).
    setConfirmOpen(false)
    removeConversation(conversationId)
    const openParam = searchParams.get('conversation')
    if (openParam && Number(openParam) === conversationId) {
      router.replace('/inbox')
    }
    router.refresh()
    toast('success', t('inbox.menu.deleted'))
  }

  const btnSize = size === 'md' ? 'size-8' : 'size-7'
  const iconSize = size === 'md' ? 'size-4' : 'size-3.5'
  // Keep the trigger visible whenever its own menu is open, even if the row is no
  // longer hovered — otherwise moving to the next row would hide it mid-interaction.
  const visibility =
    revealOnHover && !menuOpen
      ? 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
      : 'opacity-100'

  return (
    <div className='shrink-0'>
      <button
        ref={btnRef}
        type='button'
        aria-label={t('inbox.menu.label')}
        aria-haspopup='menu'
        aria-expanded={menuOpen}
        className={`inline-flex ${btnSize} items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${visibility}`}
        onClick={(e) => {
          // The list row is a <Link>; keep the ⋮ from triggering navigation.
          e.preventDefault()
          e.stopPropagation()
          if (menuOpen) setMenuOpen(false)
          else openMenu()
        }}
      >
        <MoreVertical aria-hidden className={iconSize} />
      </button>

      {menuOpen && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role='menu'
              // Portalled to <body>: it declares the interface language itself.
              {...region}
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
              className='min-w-[10rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg'
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
                {t('inbox.menu.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}

      <ConfirmPop
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onConfirm}
        msg={t('inbox.menu.confirm')}
        confirmLbl={t('inbox.menu.delete')}
        cancelLbl={t('inbox.menu.cancel')}
        destructive
        translated
      />
    </div>
  )
}
