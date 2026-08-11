import Link from 'next/link'
import type { GuideArticle as Article } from '@/lib/support/knowledgeBase'
import { CATEGORY_COPY } from '@/lib/support/copy'

/**
 * One guide.
 *
 * Ends with a route back into support, because the honest outcome of reading a
 * guide is sometimes "this did not solve it" — and at that moment the customer
 * should not have to navigate backwards to find help again.
 */
export default function GuideArticle({ article }: { article: Article }) {
  return (
    <>
      <article>
        <p className='text-xs font-medium text-gray-400'>{CATEGORY_COPY[article.category]}</p>
        <h1 className='mt-1 text-2xl font-bold text-ink'>{article.title}</h1>
        <p className='mt-2 text-sm leading-relaxed text-gray-500'>{article.summary}</p>

        {article.sections.map((s) => (
          <section key={s.heading} className='mt-7'>
            <h2 className='text-base font-bold text-ink'>{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className='mt-2 text-sm leading-relaxed text-gray-600'>
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>

      <div className='mt-10 border-t border-gray-100 pt-5'>
        <p className='text-sm text-gray-500'>
          זה לא פתר את הבעיה?{' '}
          <Link href='/support/new?kind=problem' className='font-medium text-primary-text hover:underline'>
            ספרו לנו מה קרה
          </Link>
        </p>
      </div>
    </>
  )
}
