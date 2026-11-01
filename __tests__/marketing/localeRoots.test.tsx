/**
 * The language roots of the marketing site (SEO L1).
 *
 * Hebrew at `/`, English at `/en`, Arabic at `/ar`, each with its own root
 * layout so `lang` and `dir` are in the first server response rather than
 * patched onto <html> after hydration. `/en` and `/ar` are placeholders until
 * translated pages exist: they must be reachable signed-out, but never indexed,
 * listed in the sitemap, or linked.
 */

import { describe, test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import type { ReactElement } from 'react'

vi.mock('next/font/google', () => ({ Assistant: () => ({ className: 'font', variable: '--font-assistant' }) }))
vi.mock('@/lib/css/main.css', () => ({}))

import EnglishRootLayout from '@/app/(en)/layout'
import ArabicRootLayout from '@/app/(ar)/layout'
import { metadata as englishMetadata } from '@/app/(en)/en/page'
import { metadata as arabicMetadata } from '@/app/(ar)/ar/page'
import sitemap from '@/app/sitemap'
import { proxy } from '@/proxy'

type HtmlProps = { lang: string; dir: string }

describe('each language root sets lang and dir on the server-rendered <html>', () => {
  test.each([
    ['English', EnglishRootLayout, 'en', 'ltr'],
    ['Arabic', ArabicRootLayout, 'ar', 'rtl'],
  ])('%s', (_name, Layout, lang, dir) => {
    const html = Layout({ children: null }) as ReactElement<HtmlProps>
    expect(html.type).toBe('html')
    expect(html.props).toMatchObject({ lang, dir })
  })

  test('Hebrew keeps its <html lang="he" dir="rtl">', () => {
    const src = readFileSync('app/(he)/layout.tsx', 'utf8')
    expect(src).toContain(`<html lang='he' dir='rtl' data-scroll-behavior='smooth' suppressHydrationWarning>`)
  })
})

describe('the /en and /ar placeholders stay out of search', () => {
  test.each([
    ['/en', englishMetadata],
    ['/ar', arabicMetadata],
  ])('%s is noindex, nofollow', (_path, metadata) => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  test('neither is in the sitemap', () => {
    const paths = sitemap().map((e) => new URL(e.url).pathname)
    expect(paths.filter((p) => p === '/en' || p.startsWith('/en/') || p === '/ar' || p.startsWith('/ar/'))).toEqual([])
  })
})

describe('the proxy lets signed-out visitors reach /en and /ar, and nothing else new', () => {
  const signedOut = (path: string) => proxy(new NextRequest(`https://getsocialcrm.com${path}`))

  test.each(['/en', '/ar', '/en/pricing', '/ar/pricing'])('%s is not sent to /auth', async (path) => {
    const res = await signedOut(path)
    expect(res.headers.get('location')).toBeNull()
  })

  test.each(['/enterprise', '/archive', '/dashboard'])('%s still redirects to /auth', async (path) => {
    const res = await signedOut(path)
    expect(res.headers.get('location')).toBe('https://getsocialcrm.com/auth')
  })
})

test('unmatched URLs get the Hebrew 404, not a bare document', () => {
  const src = readFileSync('app/global-not-found.tsx', 'utf8')
  expect(src).toMatch(/import RootLayout from '\.\/\(he\)\/layout'/)
  expect(readFileSync('next.config.mjs', 'utf8')).toMatch(/globalNotFound: true/)
})
