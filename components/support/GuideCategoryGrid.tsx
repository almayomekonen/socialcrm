import Link from 'next/link'
import { CATEGORY_COPY } from '@/lib/support/copy'
import { GUIDE_CATEGORY_ORDER, articlesByCategory } from '@/lib/support/knowledgeBase'

/**
 * Guides, grouped by the area they are about.
 *
 * SECONDARY ASSISTANCE, not a documentation portal. Titles carry the whole
 * weight so the page can be scanned in one pass; summaries live on the article
 * itself rather than doubling the height of this list. Every category here has
 * at least one article (asserted in knowledgeBase.test.ts), so no heading can
 * render above an empty list.
 */
export default function GuideCategoryGrid() {
  return (
    <div className='grid gap-6 mobile:grid-cols-1 desktop:grid-cols-2'>
      {GUIDE_CATEGORY_ORDER.map((category) => {
        const articles = articlesByCategory(category)
        if (articles.length === 0) return null
        return (
          <section key={category}>
            <h2 className='mb-2 text-sm font-bold text-gray-400'>{CATEGORY_COPY[category]}</h2>
            <ul className='space-y-1.5'>
              {articles.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/support/guides/${a.slug}`}
                    className='text-sm text-primary-text hover:underline'
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
