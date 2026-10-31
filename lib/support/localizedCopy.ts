import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { AUTHOR_LABEL, CATEGORY_COPY, KIND_COPY, STATUS_COPY, supportErrorMessage } from './copy'
import { GUIDE_ARTICLES, searchArticles, type GuideArticle } from './knowledgeBase'
import { SUBJECT_FALLBACK } from './derive'
import { ARTICLE_KEYS } from './articleKeys'
import type { SupportCategory, SupportErrorCode, SupportKind, SupportStatus } from './vocabulary'

/**
 * The support centre's copy in the interface language (i18n Phase F5).
 *
 * DISPLAY ONLY. Every function keys on the closed-vocabulary CODE (status,
 * category, kind, error) or the article SLUG; Hebrew returns the existing maps
 * in ./copy.ts and the articles in ./knowledgeBase.ts exactly, so the admin
 * inbox and every other Hebrew caller are unchanged. Roles, slugs, tags, the
 * order of the registry and every decision are untouched. A request's subject
 * and every message body are customer / team words and never pass here.
 */

/**
 * A request's subject is the customer's own first line, shown as written. The
 * one exception is the server's stored fallback (`SUBJECT_FALLBACK`, used when
 * there was nothing to derive from), which is our word and is labelled here.
 */
export function subjectText(subject: string, locale: UiLocale = 'he'): string {
  return locale !== 'he' && subject === SUBJECT_FALLBACK ? translatorFor(locale)('support.newRequest.title') : subject
}

const STATUS_KEYS: Record<SupportStatus, MessageKey> = {
  open: 'support.status.open',
  in_progress: 'support.status.in_progress',
  waiting_for_customer: 'support.status.waiting_for_customer',
  resolved: 'support.status.resolved',
}

// `other` is spelled `otherTopic` in the catalog: a key named `other` would read as a plural form.
const CATEGORY_KEYS: Record<SupportCategory, MessageKey> = {
  leads: 'support.category.leads',
  whatsapp: 'support.category.whatsapp',
  meta: 'support.category.meta',
  automations: 'support.category.automations',
  ai: 'support.category.ai',
  billing: 'support.category.billing',
  account: 'support.category.account',
  integrations: 'support.category.integrations',
  other: 'support.category.otherTopic',
}

const KIND_KEYS: Record<SupportKind, Record<keyof (typeof KIND_COPY)[SupportKind], MessageKey>> = {
  problem: { tileTitle: 'support.kind.problem.tileTitle', tileDescription: 'support.kind.problem.tileDescription', formTitle: 'support.kind.problem.formTitle' },
  question: { tileTitle: 'support.kind.question.tileTitle', tileDescription: 'support.kind.question.tileDescription', formTitle: 'support.kind.question.formTitle' },
}

const ERROR_KEYS: Record<SupportErrorCode, MessageKey> = {
  forbidden: 'support.error.forbidden',
  not_found: 'support.error.not_found',
  invalid_subject: 'support.error.invalid_subject',
  invalid_body: 'support.error.invalid_body',
  invalid_category: 'support.error.invalid_category',
  rate_limited: 'support.error.rate_limited',
}

export function statusLabel(status: SupportStatus, locale: UiLocale = 'he'): string {
  return locale === 'he' ? STATUS_COPY[status].label : translatorFor(locale)(STATUS_KEYS[status])
}

export function categoryLabel(category: SupportCategory, locale: UiLocale = 'he'): string {
  return locale === 'he' ? CATEGORY_COPY[category] : translatorFor(locale)(CATEGORY_KEYS[category])
}

export function kindCopy(kind: SupportKind, locale: UiLocale = 'he'): (typeof KIND_COPY)[SupportKind] {
  if (locale === 'he') return KIND_COPY[kind]
  const t = translatorFor(locale)
  const k = KIND_KEYS[kind]
  return { tileTitle: t(k.tileTitle), tileDescription: t(k.tileDescription), formTitle: t(k.formTitle) }
}

export function supportErrorText(code: SupportErrorCode, locale: UiLocale = 'he'): string {
  if (locale === 'he') return supportErrorMessage(code)
  const t = translatorFor(locale)
  return ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : t('support.error.fallback')
}

export function authorLabels(locale: UiLocale = 'he'): { self: string; support: string } {
  if (locale === 'he') return AUTHOR_LABEL
  const t = translatorFor(locale)
  return { self: t('support.author.self'), support: t('support.author.support') }
}

/**
 * The article in `locale`: same slug, category, tags, related integration and
 * section count; title, summary, headings and paragraphs from `support.kb.*`.
 */
export function localizedArticle(article: GuideArticle, locale: UiLocale = 'he'): GuideArticle {
  if (locale === 'he') return article
  const keys = ARTICLE_KEYS[article.slug]
  if (!keys) return article
  const t = translatorFor(locale)
  return {
    ...article,
    title: t(keys.title),
    summary: t(keys.summary),
    sections: article.sections.map((s, si) => ({
      heading: keys.sections[si] ? t(keys.sections[si].heading) : s.heading,
      body: s.body.map((p, pi) => (keys.sections[si]?.body[pi] ? t(keys.sections[si].body[pi]) : p)),
    })),
  }
}

/**
 * `searchArticles` in `locale`: the same substring match, over the article's
 * title and summary IN THAT LANGUAGE plus its tags (which already carry Hebrew
 * and English spellings). Hebrew is `searchArticles` itself.
 */
export function searchArticlesIn(query: string, locale: UiLocale = 'he'): GuideArticle[] {
  if (locale === 'he') return searchArticles(query)
  const q = (query ?? '').trim().toLowerCase()
  const all = GUIDE_ARTICLES.map((a) => localizedArticle(a, locale))
  if (q.length === 0) return all
  return all.filter((a) => [a.title, a.summary, ...a.tags].join(' ').toLowerCase().includes(q))
}
