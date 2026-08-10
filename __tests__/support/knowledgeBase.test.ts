import { test, expect } from 'vitest'
import { SUPPORT_CATEGORIES, GUIDE_CATEGORIES } from '@/lib/support/vocabulary'
import {
  GUIDE_ARTICLES,
  searchArticles,
  articleBySlug,
  articlesByCategory,
} from '@/lib/support/knowledgeBase'

const EMOJI = /\p{Extended_Pictographic}/u

test('every article has a category inside the vocabulary, and never "other"', () => {
  for (const a of GUIDE_ARTICLES) {
    expect(SUPPORT_CATEGORIES).toContain(a.category)
    expect(a.category).not.toBe('other')
  }
})

test('slugs are unique and URL-safe', () => {
  const slugs = GUIDE_ARTICLES.map((a) => a.slug)
  expect(new Set(slugs).size).toBe(slugs.length)
  for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
})

test('every guide category has at least one article — no empty tiles', () => {
  for (const c of GUIDE_CATEGORIES) expect(articlesByCategory(c).length).toBeGreaterThan(0)
})

test('no article contains an emoji', () => {
  for (const a of GUIDE_ARTICLES) {
    const text = [
      a.title,
      a.summary,
      ...a.tags,
      ...a.sections.flatMap((s) => [s.heading, ...s.body]),
    ]
    for (const t of text) expect(EMOJI.test(t)).toBe(false)
  }
})

test('search matches title, summary and tags, in Hebrew and English', () => {
  expect(searchArticles('whatsapp').length).toBeGreaterThan(0)
  expect(searchArticles('WhatsApp').length).toBeGreaterThan(0)
  expect(searchArticles('וואטסאפ').length).toBeGreaterThan(0)
  expect(searchArticles('לידים').length).toBeGreaterThan(0)
})

test('search is trimmed, and an empty query returns everything', () => {
  expect(searchArticles('   ')).toHaveLength(GUIDE_ARTICLES.length)
  expect(searchArticles('')).toHaveLength(GUIDE_ARTICLES.length)
})

test('a query matching nothing returns an empty array, never a fallback', () => {
  expect(searchArticles('zzzzznotathing')).toEqual([])
})

test('articleBySlug returns null for an unknown or malicious slug', () => {
  expect(articleBySlug('nope')).toBeNull()
  expect(articleBySlug('../../etc/passwd')).toBeNull()
  expect(articleBySlug('__proto__')).toBeNull()
  expect(articleBySlug('constructor')).toBeNull()
})

test('articleBySlug returns the matching article', () => {
  const first = GUIDE_ARTICLES[0]
  expect(articleBySlug(first.slug)?.slug).toBe(first.slug)
})
