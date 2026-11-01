import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAgencyUser } from '@/lib/requireUser'
import { articleBySlug } from '@/lib/support/knowledgeBase'
import GuideArticle from '@/components/support/GuideArticle'
import { localizedArticle } from '@/lib/support/localizedCopy'
import { getUser } from '@/db/auth'
import { getUiLocaleState } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translators'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = articleBySlug(slug)
  const { locale } = await getUiLocaleState(await getUser())
  return { title: article ? localizedArticle(article, locale).title : translatorFor(locale)('support.center.guides') }
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const user = await requireAgencyUser()
  const { slug } = await params

  // articleBySlug uses find(), so '__proto__' and 'constructor' resolve to null
  // like any other unknown slug rather than returning a prototype member.
  const article = articleBySlug(slug)
  if (!article) notFound()

  const { locale } = await getUiLocaleState(user)
  return <GuideArticle article={localizedArticle(article, locale)} locale={locale} />
}
