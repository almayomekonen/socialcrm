/**
 * Sitemap / robots guardrail.
 *
 * The sitemap and the route table drift silently: a new landing page ships and
 * is never submitted, or a page is removed and the sitemap keeps advertising a
 * 404. Both are invisible in review. This asserts the two agree, and that the
 * authenticated surface stays disallowed.
 *
 * Since the homepage migration there is no asymmetry left to pin: every
 * indexable route canonicalises to itself, and `/crm` is a 308 to `/`
 * (next.config.mjs) rather than a second indexable page.
 */

import { test, expect } from 'vitest'
import sitemap from '@/app/sitemap'
import robots from '@/app/robots'
import { MARKETING_ROUTES, INDEXABLE_ROUTES, SITE_URL } from './routes'

const sitemapPaths = () => sitemap().map((e) => new URL(e.url).pathname)

test('every sitemap URL is absolute and on the production origin', () => {
  for (const entry of sitemap()) {
    expect(entry.url.startsWith(`${SITE_URL}/`)).toBe(true)
  }
})

test('the sitemap lists every indexable route that canonicalises to itself', () => {
  const expected = INDEXABLE_ROUTES.filter((r) => r.canonical === `${SITE_URL}${r.path}`).map((r) => r.path)
  expect(sitemapPaths().sort()).toEqual(expected.sort())
})

test('the sitemap never lists a route that canonicalises elsewhere', () => {
  const canonicalisedAway = MARKETING_ROUTES.filter((r) => r.canonical !== `${SITE_URL}${r.path}`).map((r) => r.path)
  // Nothing canonicalises away any more; `/crm` retired to a 308.
  expect(canonicalisedAway).toEqual([])
  for (const path of canonicalisedAway) {
    expect(sitemapPaths()).not.toContain(path)
  }
})

test('the sitemap never lists a noindexed route', () => {
  const noindexed = MARKETING_ROUTES.filter((r) => !r.indexable).map((r) => r.path)
  for (const path of noindexed) {
    expect(sitemapPaths()).not.toContain(path)
  }
})

test('every sitemap entry has a priority and change frequency', () => {
  for (const entry of sitemap()) {
    expect(typeof entry.priority).toBe('number')
    expect(entry.changeFrequency).toBeTruthy()
  }
})

test('robots disallows the authenticated surface and points at the sitemap', () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules!]
  const disallow = rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []))

  // The authenticated app and the API must never be crawlable.
  for (const path of ['/auth/', '/clients/', '/dashboard/', '/leads/', '/tasks/', '/settings/', '/sum_sales/', '/api/', '/files/', '/promotion/']) {
    expect(disallow, `robots must disallow ${path}`).toContain(path)
  }
  expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
})

test('robots never disallows a public marketing route', () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules!]
  const disallow = rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : []))

  for (const route of INDEXABLE_ROUTES) {
    const blocked = disallow.some((d) => route.path === d || (d.endsWith('/') && route.path.startsWith(d)))
    expect(blocked, `robots disallows the public route ${route.path}`).toBe(false)
  }
})
