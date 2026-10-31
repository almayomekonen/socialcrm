import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { listSupportRequestsSystem } from '@/db/support/requests'
import { visibilityScopeFor } from '@/lib/support/permissions'
import { toRequestSummaries } from '@/lib/support/presenters'
import SupportRequestList from '@/components/support/SupportRequestList'
import { Btn } from '@/lib/btns/Btn'
import Loading from '@/components/ui/Loading'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language (Hebrew outside the rollout). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('support.center.mine') }
}

async function RequestsContent() {
  const user = await requireAgencyUser()

  // Scope is decided HERE from the session's role and passed in; the domain
  // primitive never derives visibility for itself.
  const rows = await listSupportRequestsSystem({
    agencyId: user.agencyId,
    viewerUserId: user.id,
    scope: visibilityScopeFor(user as any),
    limit: 50,
  })
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const requests = toRequestSummaries(rows, user.id, locale)

  return (
    <>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-ink'>{t('support.center.mine')}</h1>
        <p className='mt-1.5 text-sm text-gray-500'>{t('support.requests.intro')}</p>
      </header>

      {requests.length > 0 ? (
        <SupportRequestList requests={requests} locale={locale} />
      ) : (
        <div className='rounded-2xl border border-gray-200 p-8 text-center'>
          <p className='font-medium text-ink'>{t('support.requests.emptyTitle')}</p>
          <p className='mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500'>
            {t('support.requests.emptyBody')}
          </p>
          <Btn href={'/support/new?kind=problem' as any} lbl={t('support.kind.problem.tileTitle')} className='mx-auto mt-5' />
        </div>
      )}
    </>
  )
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RequestsContent />
    </Suspense>
  )
}
