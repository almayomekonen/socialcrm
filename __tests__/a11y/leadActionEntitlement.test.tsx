// @vitest-environment jsdom
//
// Mobile lead action sheets under the THREE-TIER policy (5dd22fdb).
//
// THE CRASH. A Server Action that THROWS — `requireProductAccess()` does, it does
// not return `{ err }` — rejects unhandled inside `startTransition` when the call
// site guards only with `isErr(res)`. Next masks the refusal as an opaque 500 and
// React reports "Minified React error #441" instead of a message.
//
// THE POLICY. Not every lead action is gated, and the fix must not re-wall the
// ones that were deliberately opened:
//
//   TIER 1 (free)   outcome  -> leadOutcome.ts   requireBasicCrmAccess
//   TIER 1 (free)   status   -> updateLead       requireBasicCrmAccess
//   TIER 2 (gated)  followUp -> leadFollowUp.ts  requireProductAccess
//
// So outcome and status keep working for an expired customer and carry a crash
// backstop only; follow-up carries the backstop AND the entitlement pre-gate.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const toastFn = vi.fn()
const logLeadOutcome = vi.fn()
const setLeadFollowUp = vi.fn()
const clearLeadFollowUp = vi.fn()
const updateLead = vi.fn()
let hasAccess = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({ toast: (...a: unknown[]) => toastFn(...a) }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({
  recordLeadActionEvent: vi.fn(async () => {}),
}))
vi.mock('@/actions/leadOutcome', () => ({ logLeadOutcome: (...a: unknown[]) => logLeadOutcome(...a) }))
vi.mock('@/actions/leadFollowUp', () => ({
  setLeadFollowUp: (...a: unknown[]) => setLeadFollowUp(...a),
  clearLeadFollowUp: (...a: unknown[]) => clearLeadFollowUp(...a),
}))
vi.mock('@/actions/clients', () => ({ updateLead: (...a: unknown[]) => updateLead(...a) }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({
  useAccessDenied: () => !hasAccess,
  useEntitlement: () => ({ status: hasAccess ? 'ACTIVE' : 'EXPIRED', hasAccess, expiresAt: null }),
}))

import LeadOutcomeSheet from '@/modules/leads/mobile/LeadOutcomeSheet'
import LeadStatusSheet from '@/modules/leads/mobile/LeadStatusSheet'
import LeadFollowUpSheet from '@/modules/leads/mobile/LeadFollowUpSheet'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
/** What a gated Server Action really does on refusal: it THROWS. */
const throwsRefusal = () => {
  throw Object.assign(new Error('subscription-required'), { name: 'ProductAccessError' })
}

beforeEach(() => {
  hasAccess = true
  toastFn.mockClear()
  logLeadOutcome.mockReset().mockResolvedValue({ nextFollowUpAt: null })
  updateLead.mockReset().mockResolvedValue({})
  setLeadFollowUp.mockReset().mockResolvedValue({})
  clearLeadFollowUp.mockReset().mockResolvedValue({})
})
afterEach(() => cleanup())

describe('TIER 1 — outcome stays free for an expired customer', () => {
  it('T1-1: expired user still sees the outcome options and can record one', async () => {
    hasAccess = false
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)

    expect(screen.queryByTestId('subscription-expired-inline')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'דיברנו' }))

    await waitFor(() => expect(logLeadOutcome).toHaveBeenCalledWith({ id: 7, outcome: 'call_reached' }))
  })

  it('T1-2: active user is unaffected', async () => {
    hasAccess = true
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)
    fireEvent.click(screen.getByRole('button', { name: 'מעוניין' }))
    await waitFor(() => expect(logLeadOutcome).toHaveBeenCalledWith({ id: 7, outcome: 'call_interested' }))
  })

  it('T1-3: a THROWN rejection becomes a toast, never an unhandled rejection (#441)', async () => {
    logLeadOutcome.mockImplementation(throwsRefusal)
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)

    fireEvent.click(screen.getByRole('button', { name: 'דיברנו' }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('error', expect.any(String)))
  })
})

describe('TIER 1 — status stays free for an expired customer', () => {
  it('T1-4: expired user still sees the statuses and can change one', async () => {
    hasAccess = false
    render(<LeadStatusSheet open onClose={() => {}} leadId={7} current='new' />)

    expect(screen.queryByTestId('subscription-expired-inline')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /בטיפול/ }))

    await waitFor(() => expect(updateLead).toHaveBeenCalledWith({ id: 7, status: 'contacted' }))
  })

  it('T1-5: a THROWN rejection becomes a toast, never an unhandled rejection (#441)', async () => {
    updateLead.mockImplementation(throwsRefusal)
    render(<LeadStatusSheet open onClose={() => {}} leadId={7} current='new' />)

    fireEvent.click(screen.getByRole('button', { name: /בטיפול/ }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('error', expect.any(String)))
  })
})

describe('TIER 2 — follow-up is gated', () => {
  it('T2-1: expired user gets the compact lock and Renew, and no action fires', () => {
    hasAccess = false
    render(<LeadFollowUpSheet open onClose={() => {}} leadId={7} current={null} />)

    expect(screen.getByTestId('subscription-expired-inline')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'חידוש מנוי' })).toBeTruthy()
    expect(setLeadFollowUp).not.toHaveBeenCalled()
    expect(clearLeadFollowUp).not.toHaveBeenCalled()
  })

  it('T2-2: active user sees the real controls, not the lock', () => {
    hasAccess = true
    render(<LeadFollowUpSheet open onClose={() => {}} leadId={7} current={null} />)
    expect(screen.queryByTestId('subscription-expired-inline')).toBeNull()
  })

  it('T2-3: a mid-session throw is contained — no unhandled rejection (#441)', async () => {
    // Client still believes it has access; the server refuses. The catch is the
    // only thing standing between that and a crashed render.
    hasAccess = true
    setLeadFollowUp.mockImplementation(throwsRefusal)
    render(<LeadFollowUpSheet open onClose={() => {}} leadId={7} current={null} />)

    const btn = screen.getAllByRole('button').find((b) => /מחר|היום|בעוד/.test(b.textContent || ''))
    expect(btn, 'expected a quick follow-up option').toBeTruthy()
    fireEvent.click(btn!)

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('error', expect.any(String)))
  })
})

describe('the policy is pinned in source, not just in behaviour', () => {
  it('POL-1: outcome and status carry NO entitlement pre-gate (Tier 1 must stay free)', () => {
    for (const f of ['modules/leads/mobile/LeadOutcomeSheet.tsx', 'modules/leads/mobile/LeadStatusSheet.tsx']) {
      expect(src(f), `${f} must not gate a Tier 1 action`).not.toContain('useAccessDenied')
      expect(src(f), `${f} must not lock a Tier 1 action`).not.toContain('SubscriptionExpiredState')
    }
  })

  it('POL-2: follow-up DOES carry the entitlement pre-gate (Tier 2)', () => {
    const f = src('modules/leads/mobile/LeadFollowUpSheet.tsx')
    expect(f).toContain('useAccessDenied')
    expect(f).toContain('SubscriptionExpiredState')
  })

  it('POL-3: all three call sites are crash-safe — every action await is caught', () => {
    for (const f of [
      'modules/leads/mobile/LeadOutcomeSheet.tsx',
      'modules/leads/mobile/LeadStatusSheet.tsx',
      'modules/leads/mobile/LeadFollowUpSheet.tsx',
    ]) {
      expect(src(f), `${f} must catch a thrown Server Action`).toMatch(/try \{[\s\S]*?\} catch/)
    }
  })

  it('POL-4: the server guards and their tiers are unchanged', () => {
    expect(src('actions/leadOutcome.ts')).toContain('requireBasicCrmAccess')
    expect(src('actions/leadOutcome.ts')).not.toContain('requireProductAccess')
    expect(src('actions/leadFollowUp.ts')).toContain('requireProductAccess')
    expect(src('lib/requireUser.ts')).toContain('throw new ProductAccessError')
  })

  it('POL-5: gated action still checks entitlement BEFORE mutating', () => {
    const s = src('actions/leadFollowUp.ts')
    expect(s.indexOf('requireProductAccess()')).toBeLessThan(s.indexOf("db('clients')"))
  })

  it('POL-6: ownership/permission scoping is untouched — queries stay agency-scoped', () => {
    for (const f of ['actions/leadOutcome.ts', 'actions/leadFollowUp.ts']) {
      expect(src(f), `${f} must scope by agencyId`).toContain('agencyId: user.agencyId')
    }
  })
})
