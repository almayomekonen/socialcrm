import Link from 'next/link'
import type { GuideArticle as Article } from '@/lib/support/knowledgeBase'
import { categoryLabel } from '@/lib/support/localizedCopy'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * One guide.
 *
 * Ends with a route back into support, because the honest outcome of reading a
 * guide is sometimes "this did not solve it" — and at that moment the customer
 * should not have to navigate backwards to find help again.
 */
/** `article` arrives already in `locale` (`localizedArticle`); this words the chrome around it. */
export default function GuideArticle({ article, locale = 'he' }: { article: Article; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <>
      <article>
        <p className='text-xs font-medium text-gray-400'>{categoryLabel(article.category, locale)}</p>
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
          {t('support.guides.notSolved')}{' '}
          <Link href='/support/new?kind=problem' className='font-medium text-primary-text hover:underline'>
            {t('support.guides.tellUs')}
          </Link>
        </p>
      </div>
    </>
  )
}
