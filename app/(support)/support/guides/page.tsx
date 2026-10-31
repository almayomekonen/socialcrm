import Link from 'next/link'
import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { categoryLabel, searchArticlesIn } from '@/lib/support/localizedCopy'
import SupportSearch from '@/components/support/SupportSearch'
import GuideCategoryGrid from '@/components/support/GuideCategoryGrid'
import { Btn } from '@/lib/btns/Btn'
import { getUser } from '@/db/auth'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language (Hebrew outside the rollout). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('support.center.guides') }
}

/**
 * The knowledge base: a scanning surface, not a documentation portal.
 *
 * Two states, never both — categories, or search results. Filtered-empty keeps
 * the search visible and turns the dead end into a route into support, which is
 * the only honest thing to offer someone who looked and did not find it.
 */
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requireAgencyUser()
  const { q } = await searchParams
  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const query = (q ?? '').trim()
  const results = query ? searchArticlesIn(query, locale) : []

  return (
    <>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-ink'>{t('support.center.guides')}</h1>
        <p className='mt-1.5 text-sm text-gray-500'>{t('support.guides.intro')}</p>
      </header>

      <SupportSearch className='mb-8' initialQuery={query} />

      {query ? (
        results.length > 0 ? (
          <ul className='divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200'>
            {results.map((a) => (
              <li key={a.slug}>
                <Link href={`/support/guides/${a.slug}`} className='block px-4 py-3 hover:bg-gray-50'>
                  <span className='block text-sm font-medium text-ink'>{a.title}</span>
                  <span className='block text-xs text-gray-500'>{categoryLabel(a.category, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className='rounded-2xl border border-gray-200 p-8 text-center'>
            <p className='font-medium text-ink'>{t('support.guides.emptyTitle')}</p>
            <p className='mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500'>
              {t('support.guides.emptyBody')}
            </p>
            <Btn
              href={'/support/new?kind=problem' as any}
              lbl={t('support.kind.problem.tileTitle')}
              className='mx-auto mt-5'
            />
          </div>
        )
      ) : (
        <>
          <GuideCategoryGrid locale={locale} />
          <div className='mt-10 border-t border-gray-100 pt-5'>
            <p className='text-sm text-gray-500'>{t('support.guides.notFound')}</p>
            <Btn
              href={'/support/new?kind=problem' as any}
              lbl={t('support.kind.problem.tileTitle')}
              className='mt-3 w-full desktop:w-auto'
            />
          </div>
        </>
      )}
    </>
  )
}
