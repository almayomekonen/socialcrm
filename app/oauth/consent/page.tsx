import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { connection } from 'next/server'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { isMcpEnabled } from '@/lib/flags/mcpFlags'
import { PENDING_COOKIE, verifyPendingRequest } from '@/lib/oauth/server/pendingRequest'
import { checkConsentEligibility, type ConsentIneligibleReason } from '@/lib/oauth/server/consentEligibility'
import { CONSENT_EXPIRED, isPendingRequestUsed } from '@/lib/oauth/server/consentDecision'
import ConsentCard from '@/components/oauth/ConsentCard'
import ConsentMessage from '@/components/oauth/ConsentMessage'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'
import type { MessageKey } from '@/lib/i18n/translate'

/** The signed-in user's interface language (Hebrew when signed out — the page then redirects to sign-in). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getServerT(await getUser()))('auth.oauth.title') }
}

// The wording of each ineligible reason (`{client}` = the validated clientName
// from the signed pending request); which reason applies and whether billing is
// offered are unchanged. Hebrew: auth.oauth.message.* = the former sentences.
const UNAVAILABLE: MessageKey = 'auth.oauth.message.unavailable'
const NEEDS_ACCESS: MessageKey = 'auth.oauth.message.needsAccess'
const INELIGIBLE: Record<ConsentIneligibleReason, { message: MessageKey; billing: boolean }> = {
  no_user: { message: UNAVAILABLE, billing: false },
  no_agency: { message: UNAVAILABLE, billing: false },
  suspended: { message: UNAVAILABLE, billing: false },
  not_allowlisted: { message: 'auth.oauth.message.notAllowlisted', billing: false },
  trial_not_started: { message: NEEDS_ACCESS, billing: true },
  subscription_required: { message: NEEDS_ACCESS, billing: true },
}

/**
 * The consent screen. Identity comes from the current session (never the
 * pending cookie); eligibility is re-read from the database here and again on
 * submit. Not signed in → the existing login page, which resumes here (D1).
 */
export default async function ConsentPage() {
  // Request-time only (see the authorize route): never prerender this page.
  await connection()
  if (!isMcpEnabled()) notFound()

  const user = await getUser()
  if (!user) redirect('/auth')

  const pending = await verifyPendingRequest((await cookies()).get(PENDING_COOKIE)?.value)
  // Display only: the signed-in user's interface language (flag + pilot allow-list + stored preference),
  // never the `ui_locale` cookie. Hebrew shows CONSENT_EXPIRED itself.
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  if (!pending || (await isPendingRequestUsed(pending.jti)))
    return <ConsentMessage message={locale === 'he' ? CONSENT_EXPIRED : t('auth.oauth.message.expired')} locale={locale} />

  const eligible = await checkConsentEligibility(Number(user.id))
  if ('reason' in eligible) {
    const { message, billing } = INELIGIBLE[eligible.reason]
    return (
      <ConsentMessage
        message={t(message, { client: pending.clientName })}
        showBilling={billing}
        clientName={pending.clientName}
        locale={locale}
      />
    )
  }

  const agency = await db('agencies').where({ id: eligible.user.agencyId }).first('name')
  const card = (
    <ConsentCard
      clientName={pending.clientName}
      redirectHost={new URL(pending.redirectUri).host}
      userName={eligible.user.firstName ?? ''}
      agencyName={typeof agency?.name === 'string' ? agency.name : ''}
      scopes={pending.scopes}
      csrf={pending.csrf}
      {...(locale === 'he' ? {} : { locale })}
    />
  )
  // Hebrew returns the card itself with the same props as before (useT() and the card default to Hebrew).
  if (locale === 'he') return card
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      {card}
    </I18nProvider>
  )
}
