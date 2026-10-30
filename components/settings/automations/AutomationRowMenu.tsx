'use client'

import { createPortal } from 'react-dom'
import Icon from '@/lib/Icon'
import { useFloatingMenu } from '@/lib/useFloatingMenu'

/**
 * The row's one menu button and its menu — edit, log, duplicate, delete.
 *
 * Extracted from AutomationCard, which had crossed the file-size soft limit
 * (architecture-rules §1: the touch is the trigger). Unchanged: the menu is
 * still portalled and positioned by the shared floating-menu hook, and every
 * item closes it before it runs.
 */
export default function AutomationRowMenu({
  name,
  busy,
  onEdit,
  onActivity,
  onDuplicate,
  onDelete,
}: {
  name: string
  busy?: boolean
  onEdit: () => void
  onActivity: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const menu = useFloatingMenu()
  return (
    <div ref={menu.wrapRef} className='inline-flex flex-none'>
      <button
        type='button'
        aria-label={`פעולות · ${name}`}
        aria-haspopup='menu'
        aria-expanded={menu.open}
        disabled={busy}
        onClick={menu.toggle}
        className='flex size-7 items-center justify-center rounded-md opacity-0 transition-opacity duration-150 hover:bg-[#eeeff2] focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100'
      >
        <Icon name='ellipsis' type='reg' className='size-4 bg-[#8b98a8]' />
      </button>
      {menu.open &&
        menu.pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menu.menuRef}
            role='menu'
            style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, zIndex: 100000 }}
            className='flex w-40 flex-col gap-0.5 rounded-lg border border-border bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]'
          >
            <MenuItem onClick={() => (menu.close(), onEdit())}>ערוך</MenuItem>
            <MenuItem onClick={() => (menu.close(), onActivity())}>יומן פעילות</MenuItem>
            <MenuItem onClick={() => (menu.close(), onDuplicate())}>שכפל</MenuItem>
            <MenuItem destructive onClick={() => (menu.close(), onDelete())}>
              מחק
            </MenuItem>
          </div>,
          document.body,
        )}
    </div>
  )
}

function MenuItem({
  onClick,
  destructive,
  children,
}: {
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      role='menuitem'
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-start text-[13px] hover:bg-[#f7f8fa] ${
        destructive ? 'text-error' : 'text-ink'
      }`}
    >
      {children}
    </button>
  )
}
