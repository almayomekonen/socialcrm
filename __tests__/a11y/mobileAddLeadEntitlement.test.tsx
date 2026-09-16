// @vitest-environment jsdom
//
// Mobile "הוסף ליד" under the three-tier policy.
//
// WHAT WAS BROKEN. Creating a lead is Tier 2: `upsertLead` opens with
// `requireBasicCrmAccess()` (editing stays free) and escalates to
// `requireProductAccess()` on its create branch. That guard THROWS — but
// `upsertLead`'s own catch handles `QuotaExceededError` specially and funnels
// everything else into `{ err: true, msg: 'שגיאה בשמירת לקוח' }`. So an expired
// customer was told their lead failed to save, and invited to retry something
// that can never succeed.
//
// Desktop already refuses BEFORE submitting (ClientFormPop). Mobile did not.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const upsertLead = vi.fn()
let hasAccess = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/hooksNEvents', () => ({ useUser: () => ({ id: 1, agencyId: 2 }) }))
vi.mock('@/actions/clients', () => ({
  upsertLead: (...a: unknown[]) => upsertLead(...a),
  getLeadByIdNum: vi.fn(async () => null),
}))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: vi.fn(async () => []) }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({
  useAccessDenied: () => !hasAccess,
  useEntitlement: () => ({ status: hasAccess ? 'ACTIVE' : 'EXPIRED', hasAccess, expiresAt: null }),
}))

import LeadFormMobile from '@/modules/leads/mobile/LeadFormMobile'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

beforeEach(() => {
  hasAccess = true
  upsertLead.mockReset().mockResolvedValue({ id: 5 })
})
afterEach(() => cleanup())

describe('expired / free customer', () => {
  it('AL-1: sees the entitlement lock, not the create form', () => {
    hasAccess = false
    render(<LeadFormMobile open onClose={() => {}} />)

    expect(screen.getByTestId('subscription-expired-state')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'הוסף ליד' })).toBeNull()
  })

  it('AL-2: the CTA is the existing renewal flow', () => {
    hasAccess = false
    render(<LeadFormMobile open onClose={() => {}} />)

    const renew = screen.getByRole('link', { name: 'חידוש מנוי' })
    expect(renew.getAttribute('href')).toContain('/settings/update_payment')
    expect(renew.getAttribute('href')).toContain('source=create_lead')
  })

  it('AL-3: the doomed mutation is never sent', () => {
    hasAccess = false
    render(<LeadFormMobile open onClose={() => {}} />)
    expect(upsertLead).not.toHaveBeenCalled()
  })

  it('AL-4: the generic save error is never what an expired customer sees', () => {
    hasAccess = false
    render(<LeadFormMobile open onClose={() => {}} />)
    expect(screen.queryByText('שגיאה בשמירת לקוח')).toBeNull()
  })
})

describe('active Pro / trial customer is unaffected', () => {
  it('AL-5: the create form renders normally', () => {
    hasAccess = true
    render(<LeadFormMobile open onClose={() => {}} />)

    expect(screen.queryByTestId('subscription-expired-state')).toBeNull()
    expect(screen.getByRole('form', { name: 'הוסף ליד' })).toBeTruthy()
  })
})

describe('policy is preserved, not widened', () => {
  it('AL-6: mobile reuses the desktop source + component, not a new mechanism', () => {
    const mobile = src('modules/leads/mobile/LeadFormMobile.tsx')
    const desktop = src('components/clients/ClientFormPop.tsx')
    for (const f of [mobile, desktop]) {
      expect(f).toContain('SubscriptionExpiredState')
      expect(f).toContain("source='create_lead'")
    }
  })

  it('AL-7: CREATE is Tier 2, EDIT stays Tier 1 — server semantics untouched', () => {
    // Scope to upsertLead's own body; the file holds many other actions.
    const s = src('actions/clients.ts')
    const from = s.indexOf('export async function upsertLead')
    expect(from).toBeGreaterThan(-1)
    const next = s.indexOf('export async function', from + 10)
    const body = s.slice(from, next > -1 ? next : undefined)

    // Enters on basic CRM (editing is free) and escalates on the create branch.
    expect(body).toContain('await requireBasicCrmAccess()')
    expect(body).toContain('await requireProductAccess()')
    expect(body.indexOf('await requireBasicCrmAccess()')).toBeLessThan(body.indexOf('await requireProductAccess()'))
  })

  it('AL-8: Tier 1 lead actions remain ungated on mobile', () => {
    for (const f of ['modules/leads/mobile/LeadOutcomeSheet.tsx', 'modules/leads/mobile/LeadStatusSheet.tsx']) {
      expect(src(f), `${f} is Tier 1 and must stay free`).not.toContain('SubscriptionExpiredState')
    }
  })
})
