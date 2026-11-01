/**
 * The 404 for unknown `/en/*` and `/ar/*` paths.
 *
 * Those paths used to fall through to the Hebrew `app/global-not-found.tsx`,
 * so an English or Arabic visitor got `<html lang="he" dir="rtl">`. The proxy
 * now answers them itself with the locale's own static 404 (see
 * lib/seo/localeNotFound for why it cannot be a `not-found.tsx` on Next 16.3).
 * The Hebrew 404 is untouched: every other path still reaches Next.
 */

import { describe, test, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { LOCALE_PAGES, localeOfPath, type MarketingLocale } from '@/lib/seo/localeNotFound'

const ORIGIN = 'https://getsocialcrm.com'

function request(path: string, signedIn = false) {
  const req = new NextRequest(`${ORIGIN}${path}`)
  if (signedIn) req.cookies.set('user', 'session')
  return proxy(req)
}

/** What a browser or crawler sees before any JavaScript runs. */
async function firstResponse(path: string, signedIn = false) {
  const res = await request(path, signedIn)
  return { res, html: await res.text() }
}

const CASES: Array<[path: string, lang: MarketingLocale, dir: 'ltr' | 'rtl', message: string]> = [
  ['/en/does-not-exist', 'en', 'ltr', 'This page could not be found.'],
  ['/en/pricing', 'en', 'ltr', 'This page could not be found.'],
  ['/en/a/b/c', 'en', 'ltr', 'This page could not be found.'],
  ['/ar/does-not-exist', 'ar', 'rtl', 'لم يتم العثور على هذه الصفحة.'],
  ['/ar/pricing', 'ar', 'rtl', 'لم يتم العثور على هذه الصفحة.'],
]

describe.each(CASES)('%s', (path, lang, dir, message) => {
  test.each([false, true])('signed in: %s → 404 in its own language, before any JavaScript', async (signedIn) => {
    const { res, html } = await firstResponse(path, signedIn)
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.startsWith(`<!DOCTYPE html><html lang="${lang}" dir="${dir}">`)).toBe(true)
    expect(html).not.toContain('<script')
  })

  test('is noindex, has no canonical, and names the page in its title', async () => {
    const { html } = await firstResponse(path)
    expect(html).toContain('<meta name="robots" content="noindex"/>')
    expect(html).not.toContain('rel="canonical"')
    expect(html).toContain(`<title>404: ${message}</title>`)
  })

  test('has one main landmark with the 404 heading and the message', async () => {
    const { html } = await firstResponse(path)
    expect(html.match(/<main /g)).toHaveLength(1)
    expect(html).toContain('<main id="main-content" class="e"><div><h1>404</h1>')
    expect(html).toContain(`<h2>${message}</h2>`)
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"/>')
  })
})

test('the requested path is never written into the page', async () => {
  const { res, html } = await firstResponse('/en/%3Cscript%3Ealert(1)%3C/script%3E')
  expect(res.status).toBe(404)
  expect(html).not.toMatch(/alert|%3C|<script/)
})

describe('everything else is left to Next', () => {
  const passesThrough = async (path: string, signedIn = false) =>
    (await request(path, signedIn)).headers.get('x-middleware-next') === '1'

  test.each(['/en', '/ar'])('the %s placeholder still renders', async (path) => {
    expect(await passesThrough(path)).toBe(true)
  })

  test('/faq/does-not-exist still reaches the Hebrew 404', async () => {
    expect(await passesThrough('/faq/does-not-exist')).toBe(true)
  })

  test.each([false, true])('/does-not-exist keeps its old behaviour (signed in: %s)', async (signedIn) => {
    const res = await request('/does-not-exist', signedIn)
    if (signedIn) expect(res.headers.get('location')).toBeNull()
    else expect(res.headers.get('location')).toBe(`${ORIGIN}/auth`)
    expect(res.status).not.toBe(404)
  })

  test.each(['/enterprise', '/archive', '/english', '/arabic'])('%s is not a locale path', async (path) => {
    expect(localeOfPath(path)).toBeNull()
    expect((await request(path)).headers.get('location')).toBe(`${ORIGIN}/auth`)
  })
})

/** URL paths of the page files under a locale's app directory. */
function pagesOnDisk(dir: string, urlBase: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) found.push(...pagesOnDisk(full, `${urlBase}/${name}`))
    else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) found.push(urlBase)
  }
  return found
}

test.each([
  ['en', 'app/(en)/en'],
  ['ar', 'app/(ar)/ar'],
] as const)('LOCALE_PAGES.%s lists exactly the pages that exist, so a new page is never answered with a 404', (locale, dir) => {
  expect([...LOCALE_PAGES[locale]].sort()).toEqual(pagesOnDisk(dir, `/${locale}`).sort())
})
