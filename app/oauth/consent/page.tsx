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

export const metadata: Metadata = { title: 'חיבור ChatGPT' }

const UNAVAILABLE = 'לא ניתן לחבר את ChatGPT לחשבון הזה כרגע.'
const NEEDS_ACCESS = 'כדי לחבר את ChatGPT צריך מנוי פעיל או תקופת ניסיון פעילה.'
const INELIGIBLE: Record<ConsentIneligibleReason, { message: string; billing: boolean }> = {
  no_user: { message: UNAVAILABLE, billing: false },
  no_agency: { message: UNAVAILABLE, billing: false },
  suspended: { message: UNAVAILABLE, billing: false },
  not_allowlisted: { message: 'החיבור ל-ChatGPT עדיין לא זמין בחשבון שלך.', billing: false },
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
  if (!pending || (await isPendingRequestUsed(pending.jti))) return <ConsentMessage message={CONSENT_EXPIRED} />

  const eligible = await checkConsentEligibility(Number(user.id))
  if ('reason' in eligible) {
    const { message, billing } = INELIGIBLE[eligible.reason]
    return <ConsentMessage message={message} showBilling={billing} />
  }

  const agency = await db('agencies').where({ id: eligible.user.agencyId }).first('name')
  return (
    <ConsentCard
      clientName={pending.clientName}
      redirectHost={new URL(pending.redirectUri).host}
      userName={eligible.user.firstName ?? ''}
      agencyName={typeof agency?.name === 'string' ? agency.name : ''}
      scopes={pending.scopes}
      csrf={pending.csrf}
    />
  )
}
