import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireAgencyUser } from '@/lib/requireUser'
import { articleBySlug } from '@/lib/support/knowledgeBase'
import GuideArticle from '@/components/support/GuideArticle'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = articleBySlug(slug)
  return { title: article ? article.title : 'מדריכים' }
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await requireAgencyUser()
  const { slug } = await params

  // articleBySlug uses find(), so '__proto__' and 'constructor' resolve to null
  // like any other unknown slug rather than returning a prototype member.
  const article = articleBySlug(slug)
  if (!article) notFound()

  return <GuideArticle article={article} />
}
