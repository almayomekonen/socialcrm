// @vitest-environment jsdom
//
// EXPIRED != LOCKED.
//
// The reported defect: in an Inbox conversation the history stayed readable but
// the lower half of the viewport became a huge centred lock — 56px icon circle,
// heading, paragraph, lapse date and a full-width button (`mode='panel'`,
// px-6 py-12). The product read as completely inaccessible even though the
// customer's data was right there.
//
// The rule these tests pin:
//   PAGE LOCK   the whole surface is genuinely unavailable  -> large state
//   ACTION LOCK readable content remains around it          -> compact strip
//
// The compact density already existed (`mode='inline'`); the surfaces were
// simply classified wrong. These tests keep them classified right.

import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/entitlement/EntitlementContext', () => ({
  useEntitlement: () => ({ status: 'EXPIRED', hasAccess: false, expiresAt: '2026-08-01T00:00:00.000Z' }),
}))

import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/** Surfaces where read-only content stays on screen -> must be compact. */
const ACTION_LOCKS: [string, string][] = [
  ['components/inbox/WhatsappComposerPanel.tsx', 'whatsapp_composer'],
  ['components/summary/WhatsappReplyDraft.tsx', 'whatsapp_reply_draft'],
  ['components/ai/LeadIntelligenceCard.tsx', 'lead_intelligence'],
]

/** Surfaces whose entire route is gated -> large state is correct. */
const PAGE_LOCKS: string[] = [
  'app/(app)/clients/[clientId]/billing/new/page.tsx',
  'app/(app)/settings/(admin_settings)/auto-response/page.tsx',
  'app/(app)/settings/(admin_settings)/automations/page.tsx',
  'app/(app)/notifications/page.tsx',
]

afterEach(() => cleanup())

describe('compact action lock', () => {
  it('EXP-1: inline density is a small strip — no giant lock icon, no paragraph, no huge padding', () => {
    const { container } = render(<SubscriptionExpiredState mode='inline' source='t' feature='שליחת הודעות מושהית' />)
    const strip = screen.getByTestId('subscription-expired-inline')
    expect(strip).toBeTruthy()
    // The large state's markers must be absent.
    expect(screen.queryByTestId('subscription-expired-state')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
    expect(strip.className).not.toMatch(/py-12|py-16/)
    expect(container.querySelector('.size-14')).toBeNull()
  })

  it('EXP-2: the compact strip still names what is paused and offers Renew', () => {
    render(<SubscriptionExpiredState mode='inline' source='whatsapp_composer' feature='שליחת הודעות מושהית' />)
    const strip = screen.getByTestId('subscription-expired-inline')
    expect(strip.textContent).toContain('שליחת הודעות מושהית')
    const renew = screen.getByRole('link', { name: 'חידוש מנוי' })
    expect(renew.getAttribute('href')).toContain('/api/payments/upgrade')
    expect(renew.getAttribute('href')).toContain('source=whatsapp_composer')
  })

  it('EXP-3: rendering the lock fires NO mutation — the CTA is a link, not an effect', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<SubscriptionExpiredState mode='inline' source='whatsapp_composer' feature='x' />)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it.each(ACTION_LOCKS)('EXP-4: %s uses the compact density, never panel/page', (file, source) => {
    const s = src(file)
    const m = s.match(/<SubscriptionExpiredState[^/]*source='([^']+)'[^/]*\/>/)
    expect(m, `${file} should render SubscriptionExpiredState`).toBeTruthy()
    const tag = m![0]
    expect(tag).toContain(source)
    expect(tag).toContain("mode='inline'")
    expect(tag).not.toContain("mode='panel'")
    expect(tag).not.toContain("mode='page'")
  })

  it.each(PAGE_LOCKS)('EXP-5: %s stays a full page lock (whole surface unavailable)', (file) => {
    expect(src(file)).toContain("mode='page'")
  })

  it('EXP-6: the inbox thread itself is never replaced by an expired state', () => {
    // Read-only conversation history must survive an expired subscription.
    const composer = src('components/inbox/WhatsappComposerPanel.tsx')
    expect(composer).toContain("mode='inline'")
    // The thread component must not gate itself at all.
    const thread = src('modules/inbox/mobile/ConversationThreadMobile.tsx')
    expect(thread).not.toContain('SubscriptionExpiredState')
  })
})
