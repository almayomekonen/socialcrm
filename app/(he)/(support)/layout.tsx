import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { GENERIC_DISPLAY_NAME, getDisplayName } from '@/lib/users/displayName'
import { getUiLocaleState } from '@/lib/i18n/server'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import SupportShell from '@/components/support/SupportShell'
import Loading from '@/components/ui/Loading'

/**
 * The Support Center route group.
 *
 * NOT gated by requireProductAccess, and NOT subject to the (app) layout's
 * phone redirect. Those two rules turn away exactly three populations — expired
 * trials, never-activated workspaces, and every mobile user — and those are the
 * people most likely to need to reach us. A support surface that goes dark when
 * the product is blocked defeats its own purpose.
 *
 * The redirect below is a UX convenience, NOT an authorization boundary: every
 * page and every action calls requireAgencyUser() independently and never
 * assumes this ran. A layout is not an authorization boundary in the App Router.
 *
 * Under cacheComponents the uncached cookie read must sit inside Suspense, the
 * same shape (app) and /activate already use.
 */
async function SupportLayoutContent({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  if (user.suspended) redirect('/api/auth/clear')
  if (!user.agencyId) redirect('/auth')

  // Resolve the name HERE and hand the shell only that. The session object
  // stays in the layout rather than being threaded through the subtree.
  const name = getDisplayName(user)

  // Interface language (i18n Phase F5), resolved once from the session user and
  // passed down as data; Hebrew outside the UI_LOCALE_* rollout, with no query
  // run. The provider is display-only here (`persistLocale={false}`): the
  // (app) layout stays the one writer of the pre-login `ui_locale` hint.
  const { locale } = await getUiLocaleState(user)
  const displayName = locale !== 'he' && name === GENERIC_DISPLAY_NAME ? translatorFor(locale)('support.shell.genericName') : name
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      <SupportShell displayName={displayName} locale={locale}>
        {children}
      </SupportShell>
    </I18nProvider>
  )
}

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <SupportLayoutContent>{children}</SupportLayoutContent>
    </Suspense>
  )
}
