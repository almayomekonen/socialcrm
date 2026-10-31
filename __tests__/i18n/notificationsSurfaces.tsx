import type { ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import type { Allowance } from './leakScan'
import type { Surface } from './surfaces'
import { NOTIF_CUSTOMER_DATA, everyEmittedShape, legacyRows } from './notificationsEnv'
import { AWAY } from './notificationsHarness'

/**
 * Leak-gate registrations for the notifications (i18n Phase F3). Spread into
 * SURFACES (surfaces.tsx). Components with fixture rows written by the
 * emitters' own copy (every shape) plus legacy rows; the real page (desktop +
 * phone, its title and regions) is covered by notificationsLocales.test.tsx.
 * The gate's poll mock is inert, so the state owner renders without fetching.
 */

async function provider(locale: UiLocale, node: ReactNode, unread = 3) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { NotificationProvider } = await import('@/modules/notifications/NotificationContext')
  return (
    <I18nProvider locale={locale}>
      <NotificationProvider enabled initialUnread={unread}>
        {node}
      </NotificationProvider>
    </I18nProvider>
  )
}

/** Names inside notification sentences (data). */
function data(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!NOTIF_CUSTOMER_DATA.includes(text)) throw new Error(`not declared as customer data: ${text}`)
    return { text, reason: 'customer-data' as const }
  })
}

/**
 * Stored text no current emitter writes, or that names a provider the catalog
 * does not know — shown exactly as stored, inside a declared Hebrew region.
 */
const VERBATIM: Allowance[] = [
  { text: 'ליד חדש: יוסי לוי', reason: 'verbatim-content' },
  { text: 'הודעה חדשה ב-Messenger — רונית', reason: 'verbatim-content' },
  { text: 'שלוש פניות בשבוע', reason: 'verbatim-content' },
  { text: 'הגיע ליד מtiktok שלא נשמר במערכת', reason: 'verbatim-content' },
]

const ROWS = () => [...everyEmittedShape(), ...legacyRows()]
const FILTERS = { unreadOnly: false, category: null }

export const NOTIFICATIONS_SURFACES: Surface[] = [
  {
    name: 'notification center (desktop) — every emitted shape, legacy rows, mark all, load more, the filters',
    route: '/notifications',
    render: async (locale) => {
      const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
      const { default: NotificationFilters } = await import('@/components/notifications/NotificationFilters')
      const rows = ROWS()
      return provider(
        locale,
        <>
          <NotificationFilters filters={{ unreadOnly: true, category: 'leads' }} locale={locale} />
          <NotificationCenter initialItems={rows} initialCursor={{ createdAt: rows[0].createdAt, id: 1 }} filters={FILTERS} />
        </>,
      )
    },
    allowed: [...data('יוסי לוי', 'מיכל אברהם', 'רונית', 'סטודיו נגה'), ...VERBATIM],
  },
  {
    name: 'notification center (phone) — every emitted shape, legacy rows, the segmented filter',
    route: '/notifications (phone)',
    render: async (locale) => {
      const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
      const { default: NotificationFiltersMobile } = await import('@/components/notifications/mobile/NotificationFiltersMobile')
      const rows = ROWS()
      return provider(
        locale,
        <>
          <NotificationFiltersMobile filters={{ unreadOnly: false, category: 'followups' }} locale={locale} />
          <NotificationCenter initialItems={rows} initialCursor={{ createdAt: rows[0].createdAt, id: 1 }} filters={FILTERS} variant='mobile' />
        </>,
      )
    },
    allowed: [...data('יוסי לוי', 'מיכל אברהם', 'רונית', 'סטודיו נגה'), ...VERBATIM],
  },
  {
    name: 'notification center — empty and filtered-empty',
    route: '/notifications',
    render: async (locale) => {
      const { default: NotificationCenter } = await import('@/components/notifications/NotificationCenter')
      return provider(
        locale,
        <>
          <NotificationCenter initialItems={[]} initialCursor={null} filters={FILTERS} />
          <NotificationCenter initialItems={[]} initialCursor={null} filters={{ unreadOnly: true, category: null }} variant='mobile' />
        </>,
      )
    },
    allowed: [],
  },
  {
    name: 'bell panel — away band, rows, mark all, view all; empty panel',
    route: '(every page, the bell)',
    render: async (locale) => {
      const { default: NotificationPanel } = await import('@/components/notifications/NotificationPanel')
      const panel = (items: ReturnType<typeof everyEmittedShape>, unread: number) => (
        <NotificationPanel
          containerRef={{ current: null }}
          pos={{ top: 0, left: 0, width: 340 }}
          items={items}
          whileYouWereAway={unread ? AWAY : null}
          unreadCount={unread}
          onSelect={() => {}}
          onMarkAllRead={() => {}}
          onClose={() => {}}
        />
      )
      return provider(
        locale,
        <>
          {panel(everyEmittedShape().slice(0, 8), 5)}
          {panel([], 0)}
        </>,
      )
    },
    allowed: data('יוסי לוי', 'מיכל אברהם'),
  },
]
