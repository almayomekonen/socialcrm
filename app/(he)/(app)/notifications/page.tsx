import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isToastEligible } from '@/lib/notifications/toastEligibility'
import { isNotificationsAgencyAllowlisted, isNotificationsEnabled } from '@/lib/notifications/flags'
import { classifyPresence } from '@/lib/notifications/presence'
import { readPresence, toPresenceRow } from '@/db/notifications/presence'
import { listNotifications, nextCursorFrom } from '@/db/notifications/feed'
import { CENTER_PAGE_SIZE, centerHref, parseCenterFilters } from '@/modules/notifications/center'
import NotificationCenter from '@/components/notifications/NotificationCenter'
import NotificationFilters from '@/components/notifications/NotificationFilters'
import NotificationFiltersMobile from '@/components/notifications/mobile/NotificationFiltersMobile'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { regionAttrs } from '@/lib/i18n/config'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The full notification center — P2.4, spec §13 and the P2 rollout list.
 *
 * INDIVIDUAL RECORDS, NEVER GROUPED. Twenty leads while you were away is twenty
 * rows, because each one is a separate piece of work. Collapse already happened
 * in the database, where a row carries `groupCount`; grouping for presentation is
 * a delivery-channel concern for push and email, and doing it here would create a
 * second, disagreeing view of the same data.
 *
 * TENANCY: `agencyId` and `userId` come from the session via `getUser()`, never
 * from the querystring. The only client input is the two filters, and both are
 * validated against fixed vocabularies by `parseCenterFilters` before reaching
 * SQL. There is no read-by-id path, so a guessed notification id addresses
 * nothing (spec §20.1).
 *
 * THE FIRST PAGE IS SERVER-RENDERED and handed to the client list as a prop —
 * complete on first paint, one round-trip, and the same query layer the feed
 * endpoint uses. It deliberately does NOT call `buildNotificationFeed`: that
 * stamps presence, and the feed poll is the single writer of `user_presence`
 * (spec §7.2). A page render is not a heartbeat.
 *
 * NOT CACHED, by construction: `getUser()` reads cookies, and nothing on this
 * path opts into `'use cache'`. Under `cacheComponents` that is what makes a
 * per-user page dynamic — see the note in the feed route for why no `dynamic`
 * export appears anywhere in this repo.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('shell.notifications.label') }
}

type SearchParams = { unread?: string | string[]; category?: string | string[] }

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getUser()
  if (!user?.agencyId) redirect('/auth')

  /**
   * The same gate the bell and the feed use. `notFound()` rather than an empty
   * shell: with the flag off there is no bell, so this URL is unreachable by
   * navigation, and a page explaining a feature the agency does not have is worse
   * than not having the page (CLAUDE.md §11).
   */
  if (!isNotificationsEnabled() || !isNotificationsAgencyAllowlisted(user.agencyId)) notFound()
  /**
   * ENTITLEMENT IS NOT AUTHENTICATION.
   *
   * This used to be `redirect('/')`, which threw a signed-in customer out of the
   * product and onto the public marketing homepage — hero copy, "start free"
   * buttons, no way back but the browser's back button. The forensic audit rated
   * it the single most damaging pattern found: it removes the customer from the
   * funnel at the exact moment they are one click from billing.
   *
   * A lapsed subscription is not a missing session. The route stays inside the
   * app shell and renders the same locked state every other gated surface shows,
   * with the renewal CTA right there. The feed below is never read, so no gated
   * data is fetched or exposed — the refusal is preserved, only its presentation
   * changed.
   */
  /*
   * TIER 2. Notifications are shown to an expired customer, not withheld: the
   * rows are their own stored events, reading them costs nothing, and each one
   * is the shortest path back to a lead or a conversation they can still work
   * on. Locking the page turned a signal into a dead end.
   *
   * The Pro gate lives at the DESTINATION, not on the link. Following a
   * notification lands on a readable object whose expensive actions (sending,
   * AI, scheduling) carry their own gate, so navigation can never become a way
   * around one.
   */

  const filters = parseCenterFilters(await searchParams)
  const scope = { agencyId: user.agencyId, userId: user.id }

  const [presenceRow, rows] = await Promise.all([
    readPresence(scope),
    listNotifications({
      ...scope,
      limit: CENTER_PAGE_SIZE,
      unreadOnly: filters.unreadOnly,
      category: filters.category,
    }),
  ])

  /**
   * `toastEligible` is decorated here for the same reason the feed assembler does
   * it: the row type carries the field, and only a layer holding presence can
   * answer it. The center never toasts — these rows are history, not arrivals —
   * so this exists to keep one item shape across both surfaces rather than a
   * near-miss variant the components would have to branch on.
   */
  const presence = classifyPresence(toPresenceRow(presenceRow), new Date())
  const items = rows.map((row) => ({
    ...row,
    toastEligible: isToastEligible({ type: row.type, priority: row.priority, presence }),
  }))

  /**
   * MOBILE PRESENTATION. Same reads, same `NotificationCenter` logic, same
   * `NotificationContext` owner — only the row layout and the filter control
   * differ. The `h1` is dropped because the mobile shell's header already says
   * "התראות"; repeating it on the phone spent a whole line restating the tab the
   * user just tapped.
   */
  const mobile = await isMobileWorkspaceRequest(user.agencyId)
  /**
   * The interface language (the layout's memoised read). The page sits inside
   * `<main>`, which declares Hebrew for untranslated content, so its root
   * declares the language again (nothing for Hebrew).
   */
  const { locale } = await getUiLocaleState(user)

  if (mobile) {
    return (
      <div className='flex flex-col gap-3 p-3' {...regionAttrs(locale)}>
        <NotificationFiltersMobile filters={filters} locale={locale} />
        <div className='overflow-hidden rounded-md border border-gray-200 bg-white'>
          <NotificationCenter
            key={centerHref(filters)}
            initialItems={items}
            initialCursor={nextCursorFrom(rows, CENTER_PAGE_SIZE)}
            filters={filters}
            variant='mobile'
          />
        </div>
      </div>
    )
  }

  return (
    <div className='grid gap-3 p-3 sm:p-4' {...regionAttrs(locale)}>
      <header className='flex flex-wrap items-center justify-between gap-2'>
        <h1 className='title'>{translatorFor(locale)('shell.notifications.label')}</h1>
      </header>

      <NotificationFilters filters={filters} locale={locale} />

      {/*
        Keyed on the filter so a filter change remounts the list with the
        server's fresh first page instead of appending it to the previous
        filter's rows.
      */}
      <NotificationCenter
        key={centerHref(filters)}
        initialItems={items}
        initialCursor={nextCursorFrom(rows, CENTER_PAGE_SIZE)}
        filters={filters}
      />
    </div>
  )
}
