'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import NavBadge from '@/lib/navs/NavBadge'
import { useFloatingMenu } from '@/lib/useFloatingMenu'
import { useNotifications } from '@/modules/notifications/NotificationContext'
import { NOTIFICATIONS_EDU } from '@/lib/education/types'
import { idsToStampSeen, renderedNotifications } from '@/modules/notifications/dropdown'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Translator } from '@/lib/i18n/translate'
import NotificationPanel from './NotificationPanel'

/**
 * The notification bell — a system control in the topbar. Spec §13.
 *
 * WHAT IT OWNS: nothing. It reads `NotificationContext`, which remains the single
 * state owner, and calls back into it for seen/read. There is no BellContext, no
 * second unread endpoint, and no poll of its own.
 *
 * THE BADGE IS NOTIFICATIONS, NOT CONVERSATIONS. `unreadCount` here is
 * `unreadNotificationCount`. The nav's conversation badge keeps its own source
 * (`useAwarenessCount`) and is not touched — two counts, two owners, one shared
 * `NavBadge` renderer so the 99+ cap cannot drift between them.
 *
 * HIDDEN WHEN THE FEATURE IS OFF, rather than rendered empty. A bell that can
 * never ring is exactly the meaningless control CLAUDE.md §11 forbids.
 */

/**
 * Wider than the 224px action-menu default because these rows carry a sentence,
 * not a verb. `estHeight` keeps the viewport flip honest for a full panel.
 */
const PANEL_PLACEMENT = { width: 340, estHeight: 420, gap: 6 }

/**
 * The bell's accessible name in the interface language. Same thresholds as
 * `bellLabel` in modules/notifications/dropdown.ts, whose Hebrew output this
 * reproduces exactly (held by __tests__/i18n/shell.test.tsx).
 */
export function bellLabelFor(t: Translator, unreadCount: number): string {
  if (unreadCount <= 0) return t('shell.notifications.label')
  if (unreadCount > 99) return t('shell.notifications.overflow')
  return t('shell.notifications.unread', { count: unreadCount })
}

/**
 * Flag gate, deliberately a separate component from the bell itself.
 *
 * Everything the bell needs — router, floating menu, the seen-stamping effect —
 * lives one level down, so when notifications are off none of it mounts at all.
 * Inertness by construction rather than by an early `return null` that still had
 * to run the hooks above it.
 */
export default function NotificationBell() {
  const { enabled } = useNotifications()
  if (!enabled) return null
  return <Bell />
}

function Bell() {
  const t = useT()
  const { unreadCount, items, whileYouWereAway, markSeen, markRead, markAllRead } = useNotifications()
  const router = useRouter()
  const menu = useFloatingMenu(PANEL_PLACEMENT)
  const btnRef = useRef<HTMLButtonElement>(null)

  const rendered = renderedNotifications(items)
  /** Stable across polls that change nothing, so the stamping effect stays quiet. */
  const renderedKey = rendered.map((i) => `${i.id}${i.seenAt ? 's' : ''}`).join(',')

  /**
   * DROPDOWN RENDER IS A SURFACE EVENT (spec §8.2). Stamping happens because the
   * panel is open and these rows are on screen — not because the feed returned
   * them, and not for the rows past the render limit. Rows arriving while the
   * panel stays open are surfaced too, which is why this tracks the rendered set
   * rather than firing once on open. `markSeen` de-duplicates, so an unchanged
   * poll costs no request.
   */
  useEffect(() => {
    if (!menu.open) return
    markSeen(idsToStampSeen(rendered))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open, renderedKey])

  /**
   * Focus moves INTO the panel on open and back to the bell on close.
   *
   * Necessary rather than decorative: the panel is portaled to `document.body`,
   * so Tab from the bell would walk the rest of the topbar instead of entering
   * it. Focusing the labelled container announces the surface and puts the rows
   * next in the tab order.
   */
  useEffect(() => {
    if (menu.open) menu.menuRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.open])

  function close() {
    menu.close()
    btnRef.current?.focus()
  }

  /**
   * Click a row: mark it read, then go to the ENTITY.
   *
   * The deep link is the one the registry stored, which always targets a business
   * object (`/clients/42`, `/inbox?conversation=9`) and never carries the
   * notification id — a notification is not a capability (spec §20.2). The
   * destination runs its own authorization at click time; nothing here pre-checks
   * or bypasses it, so a lead that moved out of reach simply refuses at its own
   * boundary.
   */
  function open(item: (typeof rendered)[number]) {
    markRead([item.id])
    close()
    router.push(item.deepLink)
  }

  return (
    <div ref={menu.wrapRef} className='inline-flex'>
      <button
        ref={btnRef}
        type='button'
        onClick={menu.toggle}
        data-edu={NOTIFICATIONS_EDU}
        aria-label={bellLabelFor(t, unreadCount)}
        aria-expanded={menu.open}
        title={t('shell.notifications.label')}
        className={[
          'relative inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
          'border focus:outline-none focus:ring-2 focus:ring-primary',
          menu.open ? 'bg-gray-900 border-gray-900 hover:bg-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50',
        ].join(' ')}
      >
        <Icon
          name='bell'
          type='sol'
          className={`size-3.5 transition-colors duration-150 ${menu.open ? 'bg-white' : 'bg-primary'}`}
        />
        {unreadCount > 0 ? <NavBadge count={unreadCount} /> : null}
      </button>

      {menu.open &&
        menu.pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <NotificationPanel
            containerRef={menu.menuRef}
            pos={menu.pos}
            items={rendered}
            whileYouWereAway={whileYouWereAway}
            unreadCount={unreadCount}
            onSelect={open}
            onMarkAllRead={markAllRead}
            onClose={close}
          />,
          document.body,
        )}
    </div>
  )
}
