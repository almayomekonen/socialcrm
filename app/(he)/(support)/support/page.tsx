import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { listSupportRequestsSystem } from '@/db/support/requests'
import { visibilityScopeFor } from '@/lib/support/permissions'
import { toRequestSummaries } from '@/lib/support/presenters'
import SupportActions from '@/components/support/SupportActions'
import SupportSearch from '@/components/support/SupportSearch'
import SupportRequestList from '@/components/support/SupportRequestList'
import { Seperator } from '@/lib/Seperator'
import Loading from '@/components/ui/Loading'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language (Hebrew outside the rollout). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('support.center.title') }
}

const RECENT_LIMIT = 5

/**
 * The Support Center.
 *
 * One glance must answer "something is wrong with SocialCRM — where do I ask
 * for help?", so the order on the page is the order of need:
 *
 *   title -> one reassuring line -> יש לי תקלה -> the two lighter actions
 *   -> separator -> search -> the conversations they already have
 *
 * Search sits BELOW the actions and behind a separator on purpose. Someone
 * arriving because something broke must land on the primary action first;
 * search serves the person who is learning, not the person who is stuck.
 */
async function SupportCenter() {
  // Re-guarded here. The layout's redirect is a convenience; this is the
  // boundary, and it is requireAgencyUser — never requireProductAccess.
  const user = await requireAgencyUser()

  const rows = await listSupportRequestsSystem({
    agencyId: user.agencyId,
    viewerUserId: user.id,
    scope: visibilityScopeFor(user as any),
    limit: RECENT_LIMIT,
  })
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const requests = toRequestSummaries(rows, user.id, locale)

  return (
    <>
      <header className='mb-8'>
        <h1 className='text-2xl font-bold text-ink'>{t('support.center.title')}</h1>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          {t('support.center.intro')}
        </p>
      </header>

      <SupportActions locale={locale} />

      <Seperator className='my-8' />

      <SupportSearch />

      {/* Exactly one page-level state: with no requests this section is ABSENT,
          not an empty box (ux-guidelines.md §4, §11). A first-time visitor sees
          a page about getting help, not a dashboard with nothing in it. */}
      {requests.length > 0 && (
        <section className='mt-10'>
          <div className='mb-3 flex items-baseline justify-between gap-3'>
            <h2 className='text-base font-bold text-ink'>{t('support.center.mine')}</h2>
            <Link
              href='/support/requests'
              className='shrink-0 text-sm font-medium text-primary-text hover:underline'
            >
              {t('support.center.all')}
            </Link>
          </div>
          <SupportRequestList requests={requests} locale={locale} />
        </section>
      )}
    </>
  )
}

export default function SupportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SupportCenter />
    </Suspense>
  )
}
