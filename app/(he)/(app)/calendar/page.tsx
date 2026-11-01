import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getUser } from '@/db/auth'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import { listUpcomingMeetings } from '@/actions/calendar'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import CalendarView from '@/components/calendar/CalendarView'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language — Hebrew ('פגישות') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('calendar.page.title') }
}

export default async function CalendarPage() {
  const user = await requireAgencyUser()

  /**
   * DESKTOP-ONLY SECTION. Returned before the connection read, so a phone never
   * runs the calendar query and never receives `CalendarView` or the
   * not-connected card (architecture-rules.md §9). The gate sits AFTER
   * `requireAgencyUser()` — device class never precedes authentication.
   */
  if (await isMobileWorkspaceRequest(user.agencyId)) return <MobileDesktopOnly section='calendar' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const conn = await getCalendarConnectionByUserId(user.id)

  // Per ux-guidelines §11: render exactly one state at a time. If the user
  // has not connected, the only job is to drive them to the settings page;
  // the meetings list is not rendered at all.
  if (!conn || conn.sync_status === 'disabled') {
    return (
      <div className='p-5' {...regionAttrs(locale)}>
        <h1 className='title'>{t('calendar.page.heading')}</h1>
        <NotConnectedState locale={locale} />
      </div>
    )
  }

  // Show all of today's meetings (including ones that already ended a few
  // hours ago) plus everything future. Without the start-of-day anchor, a
  // meeting created at 14:00 disappears at 14:01 — confusing right after
  // create. Server-side `new Date()` returns UTC instant; rounding to the
  // *day boundary* lets local-time renders still show today's events even
  // when server timezone differs from the user's.
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const meetings = await listUpcomingMeetings({ limit: 100, fromAt: todayStart })
  const needsReauth = conn.sync_status === 'reauth_required'

  return (
    <div className='p-5' {...regionAttrs(locale)}>
      <CalendarView meetings={meetings} needsReauth={needsReauth} />
    </div>
  )
}

function NotConnectedState({ locale }: { locale: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='mt-6 max-w-lg rounded-lg border border-gray-200 bg-white p-8 grid gap-4 text-center'>
      <Icon name='calendar' className='size-12 bg-gray-400 mx-auto' />
      <div className='grid gap-1'>
        <h2 className='text-xl font-bold'>{t('calendar.page.notConnected.title')}</h2>
        <p className='text-gray-600 text-sm leading-relaxed'>{t('calendar.page.notConnected.body')}</p>
      </div>
      <div className='flex justify-center'>
        <Btn lbl={t('calendar.page.notConnected.cta')} href='/settings/integrations?section=google-calendar' />
      </div>
    </div>
  )
}
