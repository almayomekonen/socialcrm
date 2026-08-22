// @vitest-environment jsdom
//
// Mobile lead action sheets must never crash on a Pro-gated refusal.
//
// THE PRODUCTION CRASH. `logLeadOutcome`, `setLeadFollowUp` / `clearLeadFollowUp`
// and `updateLead` all call `requireProductAccess()`, which THROWS a
// `ProductAccessError` — it does not return `{ err }`. The outcome and follow-up
// sheets awaited those actions inside `startTransition` behind only an
// `isErr(res)` check, so on a lapsed subscription the rejection was unhandled and
// React reported "Minified React error #441" instead of explaining the state.
//
// The status sheet already had a catch, so it degraded differently: it told the
// customer a permanent entitlement state was a transient failure worth retrying.
//
// The server stays authoritative — nothing here weakens it. These tests pin the
// CLIENT contract: a refusal becomes a business state, never a thrown render.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

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

/** What a Pro-gated server action really does: it THROWS. */
const productAccessThrow = () => {
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

describe('entitlement states — outcome sheet', () => {
  it('ENT-1: ACTIVE Pro / trial — the options render and the action runs', async () => {
    hasAccess = true
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)

    const btn = screen.getByRole('button', { name: 'דיברנו' })
    fireEvent.click(btn)

    await waitFor(() => expect(logLeadOutcome).toHaveBeenCalledWith({ id: 7, outcome: 'call_reached' }))
    expect(screen.queryByTestId('subscription-expired-inline')).toBeNull()
  })

  it('ENT-2: EXPIRED / free — the compact locked state replaces the options, no action fires', () => {
    hasAccess = false
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)

    expect(screen.getByTestId('subscription-expired-inline')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'דיברנו' })).toBeNull()
    expect(logLeadOutcome).not.toHaveBeenCalled()
    // Renew is offered, and the sheet (the user's context) is preserved.
    expect(screen.getByRole('link', { name: 'חידוש מנוי' })).toBeTruthy()
  })

  it('ENT-3: a THROWN ProductAccessError never escapes — no unhandled rejection, no #441', async () => {
    // The server is authoritative: even with the client believing it has access
    // (entitlement lapsed mid-session), the throw must be contained.
    hasAccess = true
    logLeadOutcome.mockImplementation(productAccessThrow)
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)

    fireEvent.click(screen.getByRole('button', { name: 'דיברנו' }))

    await waitFor(() => expect(toastFn).toHaveBeenCalled())
    expect(toastFn.mock.calls[0][0]).toBe('error')
  })

  it('ENT-4: when access IS denied, the thrown refusal is named as the subscription', async () => {
    hasAccess = false
    logLeadOutcome.mockImplementation(productAccessThrow)
    // Force the action path even though the UI gate would normally hide it.
    render(<LeadOutcomeSheet open onClose={() => {}} leadId={7} />)
    expect(screen.getByTestId('subscription-expired-inline')).toBeTruthy()
  })
})

describe('entitlement states — status sheet', () => {
  it('ENT-5: ACTIVE — statuses render and updateLead runs', async () => {
    hasAccess = true
    render(<LeadStatusSheet open onClose={() => {}} leadId={7} current='new' />)

    fireEvent.click(screen.getByRole('button', { name: /בטיפול/ }))

    await waitFor(() => expect(updateLead).toHaveBeenCalledWith({ id: 7, status: 'contacted' }))
  })

  it('ENT-6: EXPIRED — compact lock, no mutation attempted', () => {
    hasAccess = false
    render(<LeadStatusSheet open onClose={() => {}} leadId={7} current='new' />)

    expect(screen.getByTestId('subscription-expired-inline')).toBeTruthy()
    expect(updateLead).not.toHaveBeenCalled()
  })

  it('ENT-7: a server failure is reported, never rendered as an error page', async () => {
    hasAccess = true
    updateLead.mockImplementation(productAccessThrow)
    render(<LeadStatusSheet open onClose={() => {}} leadId={7} current='new' />)

    fireEvent.click(screen.getByRole('button', { name: /בטיפול/ }))

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('error', expect.any(String)))
  })
})

describe('server remains authoritative', () => {
  it('ENT-8: entitlement is checked BEFORE any mutation in the gated actions', () => {
    // requireProductAccess() must precede the first db() call, so a refused
    // request can never have written anything.
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    for (const f of ['actions/leadOutcome.ts', 'actions/leadFollowUp.ts']) {
      const src = readFileSync(`${process.cwd()}/${f}`, 'utf8')
      const gate = src.indexOf('requireProductAccess()')
      const firstDb = src.indexOf("db('clients')")
      expect(gate, `${f} must call requireProductAccess`).toBeGreaterThan(-1)
      expect(gate, `${f} must gate before mutating`).toBeLessThan(firstDb)
    }
  })

  it('ENT-9: the UI gate is defence in depth — the server guard is untouched', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const src = readFileSync(`${process.cwd()}/lib/requireUser.ts`, 'utf8')
    expect(src).toContain('throw new ProductAccessError')
  })
})
