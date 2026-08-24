/**
 * SEO metadata guardrail for the public marketing routes.
 *
 * These assertions are deliberately about SHAPE, not copy: they lock the
 * contract that every marketing page ships a title, a description, a canonical,
 * and complete Open Graph + Twitter cards with an ABSOLUTE image URL — the
 * thing WhatsApp and Facebook crawlers require, and the thing a visual redesign
 * is most likely to drop by accident when a page is rewritten.
 *
 * Copy itself is free to change; the contract is not.
 */

import { describe, test, expect, vi } from 'vitest'
import { MARKETING_ROUTES, SITE_URL } from './routes'

vi.mock('@/actions/auth', () => ({ getSessionState: async () => false, logout: async () => {} }))

import { metadata as home } from '@/app/(marketing)/page'
import { metadata as crm } from '@/app/(marketing)/crm/page'
import { metadata as features } from '@/app/(marketing)/features/page'
import { metadata as facebookLeads } from '@/app/(marketing)/facebook-leads/page'
import { metadata as whatsappLeads } from '@/app/(marketing)/whatsapp-leads/page'
import { metadata as crmVsExcel } from '@/app/(marketing)/crm-vs-excel/page'
import { metadata as crmForWhatsapp } from '@/app/(marketing)/crm-for-whatsapp-business/page'
import { metadata as instagramLeads } from '@/app/(marketing)/instagram-leads-crm/page'
import { metadata as pricing } from '@/app/(marketing)/pricing/page'
import { metadata as privacy } from '@/app/(marketing)/privacy/page'
import { metadata as terms } from '@/app/(marketing)/terms/page'
import { metadata as dataDeletion } from '@/app/(marketing)/data-deletion/page'
import { metadata as thankYou } from '@/app/(marketing)/thank-you/page'
import type { Metadata } from 'next'

const BY_PATH: Record<string, Metadata> = {
  '/': home,
  '/crm': crm,
  '/features': features,
  '/facebook-leads': facebookLeads,
  '/whatsapp-leads': whatsappLeads,
  '/crm-vs-excel': crmVsExcel,
  '/crm-for-whatsapp-business': crmForWhatsapp,
  '/instagram-leads-crm': instagramLeads,
  '/pricing': pricing,
  '/privacy': privacy,
  '/terms': terms,
  '/data-deletion': dataDeletion,
  '/thank-you': thankYou,
}

test('every route in the table has a metadata export wired up', () => {
  expect(Object.keys(BY_PATH).sort()).toEqual(MARKETING_ROUTES.map((r) => r.path).sort())
})

describe.each(MARKETING_ROUTES)('$path metadata', (route) => {
  const meta = () => BY_PATH[route.path]

  test('has a non-empty title and description', () => {
    const m = meta()
    expect(typeof m.title).toBe('string')
    expect((m.title as string).trim().length).toBeGreaterThan(0)
    expect(typeof m.description).toBe('string')
    expect((m.description as string).trim().length).toBeGreaterThan(0)
  })

  test('declares the expected canonical', () => {
    expect(meta().alternates?.canonical).toBe(route.canonical)
  })

  test('has complete Open Graph with an absolute image', () => {
    const og = meta().openGraph
    expect(og).toBeTruthy()
    expect(og!.title).toBeTruthy()
    expect(og!.description).toBeTruthy()
    expect((og as { url?: string }).url).toBe(route.canonical)
    expect((og as { siteName?: string }).siteName).toBe('SocialCRM')
    expect((og as { locale?: string }).locale).toBe('he_IL')

    const images = (og as { images?: Array<{ url: string; width?: number; height?: number }> }).images
    expect(Array.isArray(images) && images.length > 0).toBe(true)
    const img = images![0]
    // Absolute, not relative: crawlers fetch this URL verbatim with no base.
    expect(img.url.startsWith(`${SITE_URL}/`)).toBe(true)
    expect(img.width).toBe(1200)
    expect(img.height).toBe(630)
  })

  test('has a summary_large_image Twitter card', () => {
    const tw = meta().twitter as { card?: string; title?: unknown; description?: unknown } | undefined
    expect(tw?.card).toBe('summary_large_image')
    expect(tw?.title).toBeTruthy()
    expect(tw?.description).toBeTruthy()
  })

  test(route.indexable ? 'is indexable' : 'is noindexed', () => {
    const robots = meta().robots as { index?: boolean } | undefined
    if (route.indexable) {
      expect(robots?.index).not.toBe(false)
    } else {
      expect(robots?.index).toBe(false)
    }
  })
})

test('no two indexable routes claim the same canonical, except the /crm → / re-export', () => {
  const seen = new Map<string, string[]>()
  for (const r of MARKETING_ROUTES.filter((x) => x.indexable)) {
    seen.set(r.canonical, [...(seen.get(r.canonical) ?? []), r.path])
  }
  const shared = [...seen.entries()].filter(([, paths]) => paths.length > 1)
  // `/` and `/crm` render the same component by design, so they share one
  // canonical. Any OTHER duplicate is two pages competing for one URL.
  expect(shared.map(([canonical, paths]) => [canonical, paths.sort()])).toEqual([
    [`${SITE_URL}/`, ['/', '/crm']],
  ])
})
