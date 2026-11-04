// @vitest-environment jsdom
/**
 * What the site answers for a path with no page (SEO P0).
 *
 * A signed-out visitor to any unrecognised path used to get a 302 to /auth, so
 * crawlers saw the login page in place of every missing URL. Now only real app
 * routes redirect. Everything else reaches Next, which serves the file or a 404.
 * The status itself comes from Next, so it is checked on a running build; these
 * tests pin the proxy decision that makes it possible.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { renderPage, norm } from './harness'
import { APP_ROUTES, proxy } from '@/proxy'
import sitemap from '@/app/sitemap'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { TOKEN_SAVE_SUM } from '@/lib/payments/cardTrial/terms'
import { status as leadStatus } from '@/lib/i18n/messages/en/leads/table'

vi.mock('next/navigation', () => ({ usePathname: () => '/thank-you' }))

import ThankYouPage from '@/app/(he)/(marketing)/thank-you/page'

afterEach(cleanup)

const ORIGIN = 'https://getsocialcrm.com'

function request(path: string, signedIn = false) {
  const req = new NextRequest(`${ORIGIN}${path}`)
  if (signedIn) req.cookies.set('user', 'session')
  return proxy(req)
}

const reachesNext = async (path: string, signedIn = false) => (await request(path, signedIn)).headers.get('x-middleware-next') === '1'

describe('a signed-out visitor', () => {
  test.each(['/blog', '/about', '/contact', '/Pricing', '/does-not-exist', '/blog/a/b', '/Dashboard', '/enterprise', '/dashboards'])(
    '%s reaches Next and is not sent to the login',
    async (path) => {
      const res = await request(path)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-next')).toBe('1')
    },
  )

  test.each(['/favicon.ico', '/llms.txt', '/google381898bf1aaede03.html', '/fonts/NotoSansHebrew-Bold.ttf'])('%s reaches Next, which serves the file or a 404', async (path) => {
    expect(await reachesNext(path)).toBe(true)
  })

  test.each(APP_ROUTES)('%s still goes to the login', async (route) => {
    for (const path of [route, `${route}/anything`]) {
      const res = await request(path)
      expect(res.status, path).toBe(302)
      expect(res.headers.get('location'), path).toBe(`${ORIGIN}/auth`)
    }
  })

  test.each(['/.well-known/security.txt', '/.well-known/assetlinks.json', '/.well-known/openid-configuration'])('%s reaches Next, not the login', async (path) => {
    const res = await request(path)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  test.each(['/auth', '/auth/register'])('%s stays open', async (path) => {
    expect((await request(path)).headers.get('location')).toBeNull()
  })

  test.each(['/', '/pricing', '/faq', '/terms', '/en', '/ar', '/thank-you', '/sitemap.xml', '/robots.txt'])('%s stays public', async (path) => {
    expect(await reachesNext(path)).toBe(true)
  })
})

describe('a signed-in visitor', () => {
  test.each(['/auth', '/auth/register'])('%s still goes to the dashboard', async (path) => {
    expect((await request(path, true)).headers.get('location')).toBe(`${ORIGIN}/dashboard`)
  })

  test.each(['/dashboard', '/does-not-exist'])('%s reaches Next', async (path) => {
    expect(await reachesNext(path, true)).toBe(true)
  })
})

/** Route folders under a directory, looking through route groups like `(app)`. */
function topLevelRoutes(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .flatMap((name) => (name.startsWith('(') ? topLevelRoutes(join(dir, name)) : [`/${name}`]))
}

test('APP_ROUTES lists every route that needs a session, so none can be left open by accident', () => {
  const marketing = new Set(topLevelRoutes('app/(he)/(marketing)'))
  const onDisk = topLevelRoutes('app/(he)').filter((r) => !marketing.has(r) && r !== '/auth')
  expect([...APP_ROUTES].sort()).toEqual(onDisk.sort())
})

describe('/thank-you', () => {
  const HOSTILE = { searchParams: Promise.resolve({ title: 'SPOOFED TITLE', description: 'SPOOFED BODY' }) }

  test('shows its fixed copy, whatever the URL says', () => {
    const Page = ThankYouPage as unknown as (props: typeof HOSTILE) => React.ReactElement
    const { container } = renderPage(<Page {...HOSTILE} />)
    expect(norm(container.querySelector('h1')?.textContent)).toBe('תודה!')
    expect(norm(container.textContent)).toContain('הפעולה בוצעה בהצלחה')
    expect(container.textContent).not.toContain('SPOOFED')
  })

  test('never reads the query string', () => {
    expect(readFileSync('app/(he)/(marketing)/thank-you/page.tsx', 'utf8')).not.toMatch(/searchParams|params\./)
  })
})

describe('llms.txt', () => {
  const text = readFileSync('public/llms.txt', 'utf8')

  test('states the real trial and price, matching the constants', () => {
    expect(text).toContain(`The first ${TRIAL_LENGTH_DAYS} days are free`)
    expect(text).toContain(`${PRICING.currency}${PRICING.monthly}/month`)
    expect(text).toMatch(/^.*Card required\..*$/m)
    expect(text).toContain('currently in Hebrew')
    expect(text).toContain(`temporary hold of ${PRICING.currency}${TOKEN_SAVE_SUM}`)
  })

  test('lists the statuses the product actually has', () => {
    const { new: created, contacted, interested, closed, lost } = leadStatus
    expect(text).toContain(`${created}, ${contacted}, ${interested}, ${closed} and ${lost}`)
  })

  test.each([
    ['the old domain', /vercel\.app/],
    ['"no credit card"', /no credit card/i],
    ['free other than the trial', /\bfree\b(?<!days are free)/i],
    ['unsourced statistics', /\d+\s*%|\b\d+x\b/i],
    ['"within seconds"', /within seconds/i],
    ['the word agent for a rep', /\bagents?\b/i],
  ])('does not contain %s', (_label, pattern) => {
    expect(text).not.toMatch(pattern)
  })

  test('links only to pages in the sitemap', () => {
    const inSitemap = new Set(sitemap().map((e) => e.url.replace(/\/$/, '')))
    const links = [...text.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1].replace(/\/$/, ''))
    expect(links.length).toBeGreaterThan(5)
    for (const link of links) expect(inSitemap.has(link), link).toBe(true)
  })
})
