import Link from 'next/link'
import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { searchArticles } from '@/lib/support/knowledgeBase'
import { CATEGORY_COPY } from '@/lib/support/copy'
import SupportSearch from '@/components/support/SupportSearch'
import GuideCategoryGrid from '@/components/support/GuideCategoryGrid'
import { Btn } from '@/lib/btns/Btn'

export const metadata: Metadata = { title: 'מדריכים' }

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
  await requireAgencyUser()
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const results = query ? searchArticles(query) : []

  return (
    <>
      <header className='mb-6'>
        <h1 className='text-2xl font-bold text-ink'>מדריכים</h1>
        <p className='mt-1.5 text-sm text-gray-500'>הסברים קצרים לפי נושא.</p>
      </header>

      <SupportSearch className='mb-8' initialQuery={query} />

      {query ? (
        results.length > 0 ? (
          <ul className='divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200'>
            {results.map((a) => (
              <li key={a.slug}>
                <Link href={`/support/guides/${a.slug}`} className='block px-4 py-3 hover:bg-gray-50'>
                  <span className='block text-sm font-medium text-ink'>{a.title}</span>
                  <span className='block text-xs text-gray-500'>{CATEGORY_COPY[a.category]}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className='rounded-2xl border border-gray-200 p-8 text-center'>
            <p className='font-medium text-ink'>לא נמצאו מדריכים</p>
            <p className='mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-500'>
              אפשר לספר לנו מה קרה ואנחנו נעזור.
            </p>
            <Btn
              href={'/support/new?kind=problem' as any}
              lbl='יש לי תקלה'
              className='mx-auto mt-5'
            />
          </div>
        )
      ) : (
        <>
          <GuideCategoryGrid />
          <div className='mt-10 border-t border-gray-100 pt-5'>
            <p className='text-sm text-gray-500'>לא מצאתם מה שחיפשתם?</p>
            <Btn
              href={'/support/new?kind=problem' as any}
              lbl='יש לי תקלה'
              className='mt-3 w-full desktop:w-auto'
            />
          </div>
        </>
      )}
    </>
  )
}
