/**
 * Model B — AI entitlement source (Phase 1/E). resolvePlanAndSource must resolve
 * effective plan='free' once a grow prepaid period expires, so raw
 * agencies.plan='pro' can no longer grant paid AI. Admin grants, dev bypass,
 * allowlist, and trial behavior are preserved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, bypass: false, allow: false }))

vi.mock('@/config/db', () => ({
  db: () => ({ leftJoin: () => ({ where: () => ({ select: () => ({ first: async () => h.row }) }) }) }),
}))
vi.mock('@/lib/auth/devBypass', () => ({ isDevBypassAgency: async () => h.bypass }))
vi.mock('@/lib/ai/flags', () => ({ isAgencyAllowlisted: () => h.allow }))

import { resolvePlanAndSource } from '@/lib/entitlements/source'

const future = new Date(Date.now() + 5 * 86_400_000)
const past = new Date(Date.now() - 5 * 86_400_000)

beforeEach(() => {
  h.row = null
  h.bypass = false
  h.allow = false
})

describe('resolvePlanAndSource (Model B effective plan)', () => {
  it('active grow period → pro (payment)', async () => {
    h.row = { plan: 'pro', planReason: 'grow:t', expiresAt: future }
    expect(await resolvePlanAndSource(1)).toEqual({ plan: 'pro', planSource: 'payment' })
  })

  it('16. EXPIRED grow period → free (raw plan=pro no longer grants paid AI)', async () => {
    h.row = { plan: 'pro', planReason: 'grow:t', expiresAt: past }
    const r = await resolvePlanAndSource(1)
    expect(r.plan).toBe('free')
  })

  it('admin grant (no expiry) → pro (admin-grant)', async () => {
    h.row = { plan: 'pro', planReason: 'admin-grant:review', expiresAt: null }
    expect(await resolvePlanAndSource(1)).toEqual({ plan: 'pro', planSource: 'admin-grant' })
  })

  it('trial user (plan=free) → free (unchanged)', async () => {
    h.row = { plan: 'free', planReason: null, expiresAt: null }
    expect(await resolvePlanAndSource(1)).toEqual({ plan: 'free', planSource: null })
  })

  it('dev bypass → pro even when plan=free', async () => {
    h.row = { plan: 'free', planReason: null, expiresAt: null }
    h.bypass = true
    expect((await resolvePlanAndSource(1)).plan).toBe('pro')
  })

  it('allowlisted free workspace → free + allowlist source (unchanged)', async () => {
    h.row = { plan: 'free', planReason: null, expiresAt: null }
    h.allow = true
    expect(await resolvePlanAndSource(1)).toEqual({ plan: 'free', planSource: 'allowlist' })
  })
})
