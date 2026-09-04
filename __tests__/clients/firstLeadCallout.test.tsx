// @vitest-environment jsdom
//
// Manual first-lead "Aha" callout — one-shot behavior + the RSC-refresh /
// remount lifecycle. Pure client, no DB: run with VITEST_NO_DB=1.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, act, cleanup } from '@testing-library/react'

const replace = vi.fn()
const push = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  usePathname: () => '/clients/5/summary',
  useSearchParams: () => searchParams,
}))

const recordFirstLeadEvent = vi.fn(async () => {})
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({
  recordFirstLeadEvent: (...a: unknown[]) => recordFirstLeadEvent(...(a as [])),
}))
const followUpFireCount = () =>
  (recordFirstLeadEvent.mock.calls as unknown[][]).filter((c) => c[0] === 'first_follow_up_set').length

import FirstLeadCallout from '@/components/clients/FirstLeadCallout'
import { __resetFirstLeadFlowForTests } from '@/components/clients/firstLeadFlow'

const withParam = () => new URLSearchParams('firstLead=1')
const noParam = () => new URLSearchParams()

beforeEach(() => {
  replace.mockReset()
  push.mockReset()
  recordFirstLeadEvent.mockReset()
  searchParams = noParam()
  __resetFirstLeadFlowForTests() // simulate a fresh document (browser refresh / re-login)
})
afterEach(cleanup)

describe('FirstLeadCallout — one-shot + lifecycle', () => {
  it('renders nothing without ?firstLead=1 (ordinary open / 2nd lead / after browser refresh)', () => {
    render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(recordFirstLeadEvent).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows guidance, strips the param, fires first_lead_opened on ?firstLead=1', () => {
    searchParams = withParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    expect(screen.getByText('הליד הראשון שלך בפנים')).toBeTruthy()
    expect(screen.getByText('קבע מתי לחזור אליו, ו־SocialCRM ידאג להחזיר אותו אליך בזמן.')).toBeTruthy()
    expect(replace).toHaveBeenCalledWith('/clients/5/summary', { scroll: false })
    expect(recordFirstLeadEvent).toHaveBeenCalledWith('first_lead_opened')
  })

  it('RSC refresh (same instance, new props): follow-up set → completion, and NO event from here', () => {
    searchParams = withParam()
    const { rerender } = render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    // router.refresh() re-renders the server page: same client instance, new prop.
    searchParams = noParam() // param already stripped
    rerender(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    expect(screen.getByText('מעולה. הליד שלך בטיפול.')).toBeTruthy()
    // `first_follow_up_set` is emitted by `setLeadFollowUp` AFTER the write
    // persists — the one action both surfaces call — not by this screen, which
    // only the desktop lead-summary route renders. Asserting its ABSENCE here is
    // what keeps the single-emitter rule from silently regressing.
    expect(followUpFireCount()).toBe(0)
  })

  it('REMOUNT after strip (worst case): completion STILL survives via the module latch', () => {
    // 1) arrive with the param → flow begins, param stripped.
    searchParams = withParam()
    const first = render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    // 2) simulate a full remount (unmount + fresh instance) with the param already
    //    gone and the follow-up now set — this is the exact path that broke the
    //    old useState-from-param design.
    first.unmount()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    expect(screen.getByText('מעולה. הליד שלך בטיפול.')).toBeTruthy()
    expect(screen.queryByText('הליד הראשון שלך בפנים')).toBeNull()
  })

  it('REMOUNT before follow-up: guidance STILL survives (param already stripped)', () => {
    searchParams = withParam()
    const first = render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    first.unmount()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    expect(screen.getByText('הליד הראשון שלך בפנים')).toBeTruthy()
  })

  it('dismiss stays dismissed across a subsequent remount / refresh (module ended)', () => {
    searchParams = withParam()
    const first = render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    act(() => {
      screen.getByLabelText('סגירה').click()
    })
    expect(screen.queryByRole('status')).toBeNull()
    // remount (e.g. a later router.refresh) with the param gone → stays gone,
    // and must NOT re-show as completion even after the follow-up is set.
    first.unmount()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('back-to-leads routes to /leads and ends the flow (no replay for that lead)', () => {
    searchParams = withParam()
    const { rerender, unmount } = render(<FirstLeadCallout leadId={5} hasFollowUp={false} />)
    searchParams = noParam()
    rerender(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    act(() => {
      screen.getByText('חזרה ללידים').click()
    })
    expect(push).toHaveBeenCalledWith('/leads')
    // re-open the same lead later in the session (no param) → nothing.
    unmount()
    render(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the flow is scoped to its lead: a different lead never shows the callout', () => {
    searchParams = withParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false} />) // begins flow for lead 5
    cleanup()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={7} hasFollowUp={false} />) // different lead
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never emits first_follow_up_set — not on arrival, not across a remount', () => {
    searchParams = withParam()
    const first = render(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    const calls = followUpFireCount()
    first.unmount()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={true} />)
    const callsAfter = followUpFireCount()
    // Zero on both sides. This screen previously owned the event, which meant the
    // loop could never complete on a phone (this route is desktop-only) — the
    // reason `first_follow_up_set` had zero rows in all of production. The
    // emitter now lives in `setLeadFollowUp`; a re-added client emitter here
    // would double-count against it, so the assertion is exact, not a bound.
    expect(calls).toBe(0)
    expect(callsAfter).toBe(0)
  })
})

describe('FollowUpControl emphasis (first-lead guidance only)', () => {
  const CARD = <div data-testid='fu-card'>follow-up card</div>
  // The emphasis lives on the wrapper element around the follow-up card.
  const cardEmphasized = () => (screen.getByTestId('fu-card').parentElement?.className ?? '').includes('ring-primary')

  it('guidance active (first lead, no follow-up yet) → card gets the subtle emphasis', () => {
    searchParams = withParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false}>{CARD}</FirstLeadCallout>)
    expect(screen.getByText('הליד הראשון שלך בפנים')).toBeTruthy()
    expect(screen.getByTestId('fu-card')).toBeTruthy() // card always rendered
    expect(cardEmphasized()).toBe(true)
  })

  it('ordinary lead (no ?firstLead=1) → card rendered, NO emphasis', () => {
    searchParams = noParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false}>{CARD}</FirstLeadCallout>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('fu-card')).toBeTruthy()
    expect(cardEmphasized()).toBe(false)
  })

  it('follow-up set → completion state, emphasis DISAPPEARS', () => {
    searchParams = withParam()
    const { rerender } = render(<FirstLeadCallout leadId={5} hasFollowUp={false}>{CARD}</FirstLeadCallout>)
    expect(cardEmphasized()).toBe(true)
    searchParams = noParam()
    rerender(<FirstLeadCallout leadId={5} hasFollowUp={true}>{CARD}</FirstLeadCallout>)
    expect(screen.getByText('מעולה. הליד שלך בטיפול.')).toBeTruthy()
    expect(cardEmphasized()).toBe(false)
  })

  it('dismiss before follow-up → emphasis DISAPPEARS (same lifecycle as the callout)', () => {
    searchParams = withParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false}>{CARD}</FirstLeadCallout>)
    expect(cardEmphasized()).toBe(true)
    act(() => {
      screen.getByLabelText('סגירה').click()
    })
    expect(screen.queryByRole('status')).toBeNull() // callout gone
    expect(cardEmphasized()).toBe(false) // and so is the emphasis
    expect(screen.getByTestId('fu-card')).toBeTruthy() // card still there, usable
  })

  it('second/later lead (different id, no param) → card rendered, NO emphasis', () => {
    searchParams = withParam()
    render(<FirstLeadCallout leadId={5} hasFollowUp={false}>{CARD}</FirstLeadCallout>) // flow for lead 5
    cleanup()
    searchParams = noParam()
    render(<FirstLeadCallout leadId={7} hasFollowUp={false}>{CARD}</FirstLeadCallout>)
    expect(cardEmphasized()).toBe(false)
  })
})
