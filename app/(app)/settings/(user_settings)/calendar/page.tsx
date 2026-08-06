import { redirect } from 'next/navigation'

/**
 * `/settings/calendar` → the Google Calendar card on the merged integrations
 * page.
 *
 * Google Calendar lost its standalone nav item because connecting it does not,
 * by itself, produce a single ליד — it enriches לידים that already exist. It
 * now sits beside Google Drive under כלים מחוברים, which is also why the two
 * are no longer at different depths in the nav.
 *
 * The route survives as a redirect for the in-app CTAs that point at it
 * (`/calendar` empty state, the CalendarView reconnect banner) and any URL a
 * user has bookmarked.
 */
export default async function CalendarSettingsRedirect() {
  redirect('/settings/integrations?section=google-calendar')
}
