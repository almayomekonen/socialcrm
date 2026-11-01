import { redirect } from 'next/navigation'
import { getUser } from '@/db/auth'
import { isOnboarded } from '@/lib/activation/onboarding'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import ActivationExperience from '@/components/activation/ActivationExperience'
import MobileHandoff from '@/components/activation/mobile/MobileHandoff'
import RegistrationPixel from '@/components/activation/RegistrationPixel'
import RegistrationConversion from '@/components/analytics/RegistrationConversion'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { getUiLocaleState } from '@/lib/i18n/server'

export default async function ActivatePage() {
  const user = await getUser()
  if (!user) redirect('/auth')
  const mobile = await isMobileRequest()
  const onboarded = await isOnboarded(user.agencyId)
  if (!mobile && onboarded) redirect('/dashboard')
  // Allowlisted phones that already passed onboarding must not stay on the
  // desktop-handoff screen. The layout admits them into the workspace; this
  // page previously never consulted the allowlist, so a phone parked on
  // /activate (registration, bookmark, or the onboarding bounce) stayed closed.
  if (mobile && onboarded && canEnterMobileWorkspace(user.agencyId)) redirect('/dashboard')
  // Display only, read after every redirect decision: the signed-in user's interface language
  // (UI_LOCALE_ENABLED + the pilot allow-list + the stored preference), never the `ui_locale` cookie.
  const { locale } = await getUiLocaleState(user)
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      {/* Mobile registration attribution. Registration sends phones here (not to
          /leads) precisely because redirect() drops the query string, so this is
          the only place the CompleteRegistration pixel can fire for a phone. It
          stays mounted on BOTH branches. */}
      <RegistrationPixel userId={user.id} />

      {/* The cookie-based emitter, which survives the /dashboard redirect above
          and the dropped query string that leaves RegistrationPixel inert for an
          onboarded, allowlisted phone. Both stay mounted: they share the
          `socialcrm:completeRegFired:` key, so only one of them can fire. */}
      <RegistrationConversion />

      {/* The device decision is made HERE, on the server, and each branch
          receives only its own markup — architecture-rules.md §9 (gate by
          absence, never CSS-hide a mobile-only surface; the rule names this
          screen as its example). Phones get the handoff experience and nothing
          else; the activation flow is desktop-only. */}
      {mobile ? <MobileHandoff locale={locale} /> : <ActivationExperience />}
    </I18nProvider>
  )
}
