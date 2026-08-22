// @vitest-environment jsdom
//
// Billing Phase 2A — payment → entitlement → client unlock.
//
// The defect these cover: a customer could pay successfully and still sit in a
// visually locked product, because the client's entitlement state was seeded
// once on the server and never revisited. /billing/success announced success on
// a 5 second timer without asking whether activation had happened, and a CRM tab
// open in the background kept a latched `accessDenied` for as long as it lived.
//
// The load-bearing assertions are the ones that refuse to unlock: a fail-open
// read must never be accepted as proof of payment, and the latch must never
// clear on anything but a positive server confirmation.
//
// No DB: runs in the no-DB suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { isAccessDenied, markAccessDenied, __resetAccessDeniedForTests } from '@/lib/entitlement/pollGate'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/**
 * The same file with comments stripped. Assertions about what the CODE does
 * must not be satisfied — or broken — by what a comment happens to mention.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const { getEntitlementStatus, refresh } = vi.hoisted(() => ({
  getEntitlementStatus: vi.fn(async () => ({ active: false, status: 'TRIAL_EXPIRED' })),
  refresh: vi.fn(),
}))

vi.mock('@/actions/subscription', () => ({ getEntitlementStatus }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }))

import BillingActivationVerifier from '@/components/billing/BillingActivationVerifier'
import EntitlementRecovery from '@/components/entitlement/EntitlementRecovery'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'

beforeEach(() => {
  __resetAccessDeniedForTests()
  getEntitlementStatus.mockReset()
  getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
  refresh.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/* ------------------------------------------------------------------ *
 * The verifier: three honest states.
 * ------------------------------------------------------------------ */

describe('/billing/success verifies rather than assuming', () => {
  it('polls entitlement instead of announcing success on a timer', async () => {
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    expect(screen.getByText('התשלום התקבל')).toBeTruthy()
    expect(screen.getByText('אנחנו מאמתים את הפעלת המנוי...')).toBeTruthy()
    // The success sentence must NOT be on screen yet.
    expect(screen.queryByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeNull()
  })

  it('the old meta refresh stopwatch is gone', () => {
    const page = code('app/billing/success/page.tsx')
    expect(page).not.toContain('httpEquiv')
    expect(page).not.toContain('<meta')
    expect(page).toContain('<BillingActivationVerifier />')
  })

  it('recognises an already active entitlement immediately', async () => {
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeTruthy())
    expect(screen.getByText('SocialCRM Pro מוכן עבורך.')).toBeTruthy()
    expect(getEntitlementStatus).toHaveBeenCalledTimes(1)
  })

  it('stops polling the moment entitlement is confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getEntitlementStatus
      .mockResolvedValueOnce({ active: false, status: 'TRIAL_EXPIRED' })
      .mockResolvedValue({ active: true, status: 'PAID' })

    render(<BillingActivationVerifier />)
    await vi.waitFor(() => expect(getEntitlementStatus).toHaveBeenCalledTimes(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500) // let the scheduled retry fire
    })
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeTruthy())
    const callsAtConfirmation = getEntitlementStatus.mock.calls.length
    expect(callsAtConfirmation).toBe(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getEntitlementStatus).toHaveBeenCalledTimes(callsAtConfirmation)
  })

  it('gives up after a hard bounded window, without claiming success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<BillingActivationVerifier />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    await vi.waitFor(() =>
      expect(screen.getByText('אנחנו עדיין מחכים לאישור הסופי של התשלום.')).toBeTruthy(),
    )
    expect(screen.getByText('אפשר להיכנס למערכת ולנסות שוב בעוד כמה רגעים.')).toBeTruthy()
    expect(screen.getByText('התשלום התקבל')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeNull()

    const before = getEntitlementStatus.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getEntitlementStatus).toHaveBeenCalledTimes(before) // stopped for good
  })

  it('is bounded in source, not merely in behaviour', () => {
    const src = read('components/billing/BillingActivationVerifier.tsx')
    expect(src).toContain('const POLL_INTERVAL_MS = 2_000')
    expect(src).toContain('const MAX_WAIT_MS = 30_000')
  })

  it('refreshes App Router state once activation is confirmed', async () => {
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('clears the stale poll latch, but only after confirmation', async () => {
    markAccessDenied()
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    expect(isAccessDenied()).toBe(true) // not confirmed → still latched

    cleanup()
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(isAccessDenied()).toBe(false))
  })

  it('a failed lookup keeps waiting, and never fakes success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getEntitlementStatus.mockRejectedValue(new Error('network'))
    render(<BillingActivationVerifier />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(screen.queryByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeNull()
    expect(isAccessDenied()).toBe(false) // untouched, neither set nor cleared
  })

  it('announces the outcome to assistive tech', async () => {
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    const { container } = render(<BillingActivationVerifier />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeTruthy())
    const live = container.querySelector('[role="status"][aria-live="polite"]')
    expect(live?.textContent).toBe('המנוי הופעל בהצלחה')
  })
})

/* ------------------------------------------------------------------ *
 * The effect lifecycle. Regression cover for Phase 2A.1.
 * ------------------------------------------------------------------ */

describe('the verifier survives its effect being re-run', () => {
  /**
   * THE BUG. `stopped` and `startedAt` were `useRef`s. Cleanup set
   * `stopped.current = true` and no later run reset it, so the SECOND run of
   * the effect returned on `check()`'s first line: no confirmation, no
   * refresh, and no timeout either, because `setPhase('timeout')` is only
   * reachable from inside `check()`. The page hung on "מאמתים" forever.
   *
   * StrictMode re-runs every effect on mount in development, so this was every
   * dev load. In production it needed only `onConfirmed` to change identity.
   * These render under StrictMode so the double invocation is exercised for
   * real rather than simulated.
   */
  const strict = () =>
    render(
      <StrictMode>
        <BillingActivationVerifier />
      </StrictMode>,
    )

  it('A. a double effect run does not permanently kill polling', async () => {
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    strict()
    // Before the fix this settled at one abandoned call and never polled again.
    await waitFor(() => expect(getEntitlementStatus.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('אנחנו מאמתים את הפעלת המנוי...')).toBeTruthy()
  })

  it('B. an active entitlement confirms exactly once under StrictMode', async () => {
    markAccessDenied()
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    strict()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeTruthy())
    expect(isAccessDenied()).toBe(false)
    expect(refresh).toHaveBeenCalledTimes(1)

    // Nothing arrives late to call it a second time.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('C. StrictMode does not prevent the bounded timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    strict()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })
    await vi.waitFor(() =>
      expect(screen.getByText('אנחנו עדיין מחכים לאישור הסופי של התשלום.')).toBeTruthy(),
    )
    expect(screen.queryByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeNull()
  })

  it('D. a cancelled run cannot mutate anything after cleanup', async () => {
    markAccessDenied()
    // The action resolves only after the component is gone.
    let release: (v: { active: boolean; status: string }) => void = () => {}
    getEntitlementStatus.mockReturnValue(
      new Promise((r) => {
        release = r
      }) as never,
    )

    const { unmount } = strict()
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    unmount()

    await act(async () => {
      release({ active: true, status: 'PAID' })
      await new Promise((r) => setTimeout(r, 20))
    })

    // A confirmed-active answer arriving after cleanup must change nothing.
    expect(refresh).not.toHaveBeenCalled()
    expect(isAccessDenied()).toBe(true)
  })

  it('E. only one polling chain survives the double invocation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    strict()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000)
    })

    /**
     * One chain over a 30s window at 2s intervals is ~16 calls, plus the
     * abandoned first call from the run StrictMode discarded. Two live chains
     * would be roughly double that, so the ceiling is what proves the count.
     */
    const calls = getEntitlementStatus.mock.calls.length
    expect(calls).toBeGreaterThan(10)
    expect(calls).toBeLessThanOrEqual(20)
  })

  it('the lifecycle is per effect run, not per component', () => {
    const src = code('components/billing/BillingActivationVerifier.tsx')
    // No refs may carry cancellation across runs.
    expect(src).not.toContain('stopped.current')
    expect(src).not.toContain('useRef')
    // Each run establishes its own.
    expect(src).toContain('const startedAt = Date.now()')
    expect(src).toContain('let cancelled = false')
    expect(src).toContain('cancelled = true')
  })

  it('the bounds are unchanged by the fix', () => {
    const src = read('components/billing/BillingActivationVerifier.tsx')
    expect(src).toContain('const POLL_INTERVAL_MS = 2_000')
    expect(src).toContain('const MAX_WAIT_MS = 30_000')
  })
})

/* ------------------------------------------------------------------ *
 * Fail-open must never become proof of payment.
 * ------------------------------------------------------------------ */

describe('a fail-open entitlement read is not a confirmed payment', () => {
  /**
   * getAgencyProductAccess resolves a DB error to { status: 'UNKNOWN',
   * hasAccess: true } so infrastructure trouble cannot lock out a paying
   * customer. The verifier must not read that as activation.
   */
  it('the positive-confirmation rule lives on the server, in one place', () => {
    const src = read('actions/subscription.ts')
    expect(src).toContain("active: hasAccess && status !== 'UNKNOWN'")
    // The client never re-derives it.
    expect(read('components/billing/BillingActivationVerifier.tsx')).not.toContain('UNKNOWN')
    expect(read('components/entitlement/EntitlementRecovery.tsx')).not.toContain('UNKNOWN')
  })

  it('an UNKNOWN fail-open answer does not unlock or announce', async () => {
    markAccessDenied()
    // What the action returns for a fail-open read: active is false.
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'UNKNOWN' })
    render(<BillingActivationVerifier />)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: 'המנוי הופעל בהצלחה' })).toBeNull()
    expect(isAccessDenied()).toBe(true)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('the resolver itself is untouched and still fails open', () => {
    const src = read('lib/access/productAccess.ts')
    expect(src).toContain("return { status: 'UNKNOWN', hasAccess: true } // infra error → fail open")
    expect(src).toContain('export const getAgencyProductAccess = cache(')
  })
})

/* ------------------------------------------------------------------ *
 * The other tab.
 * ------------------------------------------------------------------ */

describe('an existing CRM tab recovers without a reload', () => {
  const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: null }
  const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: null }

  function mount(value: typeof EXPIRED) {
    return render(
      <EntitlementProvider value={value}>
        <EntitlementRecovery />
      </EntitlementProvider>,
    )
  }

  it('a lapsed tab re-checks and unlocks once the server confirms', async () => {
    markAccessDenied()
    getEntitlementStatus.mockResolvedValue({ active: true, status: 'PAID' })
    mount(EXPIRED)
    await waitFor(() => expect(isAccessDenied()).toBe(false))
    expect(refresh).toHaveBeenCalled()
  })

  it('re-checks when the customer returns to the tab', async () => {
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    mount(EXPIRED)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalledTimes(1))
    expect(read('components/entitlement/EntitlementRecovery.tsx')).toContain(
      "document.addEventListener('visibilitychange', recheck)",
    )
    expect(read('components/entitlement/EntitlementRecovery.tsx')).toContain(
      "window.addEventListener('focus', recheck)",
    )
  })

  it('a paying customer never triggers a single call', async () => {
    mount(ACTIVE)
    await new Promise((r) => setTimeout(r, 20))
    expect(getEntitlementStatus).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a negative answer changes nothing at all', async () => {
    markAccessDenied()
    getEntitlementStatus.mockResolvedValue({ active: false, status: 'TRIAL_EXPIRED' })
    mount(EXPIRED)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    expect(isAccessDenied()).toBe(true)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a transient failure cannot revoke access', async () => {
    getEntitlementStatus.mockRejectedValue(new Error('boom'))
    mount(EXPIRED)
    await waitFor(() => expect(getEntitlementStatus).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
    expect(isAccessDenied()).toBe(false) // never set by the recovery path
  })

  it('it renders nothing', () => {
    const { container } = mount(EXPIRED)
    expect(container.innerHTML).toBe('')
  })

  it('is mounted inside the provider it depends on', () => {
    const layout = read('app/(app)/layout.tsx')
    expect(layout).toContain('<EntitlementRecovery />')
    expect(layout.indexOf('<EntitlementProvider')).toBeLessThan(layout.indexOf('<EntitlementRecovery />'))
  })

  it('is throttled, so returning to the tab is not a poll', () => {
    const src = read('components/entitlement/EntitlementRecovery.tsx')
    expect(src).toContain('const THROTTLE_MS = 10_000')
    expect(src).toContain('if (now - lastCheck < THROTTLE_MS) return')
  })
})

/* ------------------------------------------------------------------ *
 * The latch, and what may clear it.
 * ------------------------------------------------------------------ */

describe('the poll latch resets only on positive confirmation', () => {
  it('nothing clears it on a timer or a retry', () => {
    for (const f of [
      'components/billing/BillingActivationVerifier.tsx',
      'components/entitlement/EntitlementRecovery.tsx',
    ]) {
      const src = code(f)
      // Exactly one reset per file, and the file gates on a confirmed answer.
      expect(src.match(/clearAccessDenied\(\)/g)?.length, f).toBe(1)
      expect(src, f).toMatch(/if \(res\.active\)|if \(cancelled \|\| !res\.active\) return/)
      // No timer, interval or retry may reach the reset.
      expect(src, f).not.toMatch(/setInterval[\s\S]{0,200}clearAccessDenied/)
    }
    // The verifier resets only inside its confirmation handler.
    const verifier = code('components/billing/BillingActivationVerifier.tsx')
    const start = verifier.indexOf('const onConfirmed')
    const handler = verifier.slice(start, verifier.indexOf('useEffect(', start))
    expect(handler).toContain('clearAccessDenied()')
    expect(handler).toContain('router.refresh()')
  })

  it('the setter still fires only on a 403, as before', () => {
    for (const f of [
      'modules/inbox/client/InboxSyncLoop.tsx',
      'modules/inbox/awareness/AwarenessContext.tsx',
      'modules/notifications/NotificationPoller.tsx',
    ]) {
      expect(read(f), f).toContain('if (res.status === 403) markAccessDenied()')
    }
  })

  it('the reset is exported deliberately, separate from the test helper', () => {
    const gate = read('lib/entitlement/pollGate.ts')
    expect(gate).toContain('export function clearAccessDenied(): void')
    expect(gate).toContain('export function __resetAccessDeniedForTests(): void')
  })
})

/* ------------------------------------------------------------------ *
 * Blast radius.
 * ------------------------------------------------------------------ */

describe('nothing else was touched to achieve this', () => {
  it('the client never contacts the payment provider', () => {
    for (const f of [
      'components/billing/BillingActivationVerifier.tsx',
      'components/entitlement/EntitlementRecovery.tsx',
    ]) {
      const src = code(f)
      expect(src, f).not.toMatch(/fetch\(|meshulam|payment_?link|api\/payments/i)
    }
  })

  it('no transaction id or billing detail reaches the client', () => {
    const action = code('actions/subscription.ts')
    const at = action.indexOf('export async function getEntitlementStatus')
    expect(at).toBeGreaterThan(-1)
    expect(action.slice(at)).not.toMatch(/transactionId|amount|payments\(|webhookKey/)
    expect(code('components/billing/BillingActivationVerifier.tsx')).not.toMatch(/transactionId|amount/)
  })

  it('the verifier triggers no AI, automation or notification work', () => {
    for (const f of [
      'components/billing/BillingActivationVerifier.tsx',
      'components/entitlement/EntitlementRecovery.tsx',
    ]) {
      const src = code(f)
      expect(src, f).not.toMatch(/leadIntelligence|lib\/ai|emitAutomationEvent|notifyEvent|proToast/)
    }
  })

  it('the entitlement model and its guards are unchanged', () => {
    expect(read('lib/requireUser.ts')).toContain('export async function requireProductAccess')
    const ctx = read('lib/entitlement/EntitlementContext.tsx')
    expect(ctx).toContain('const FALLBACK: EntitlementState = { hasAccess: true')
    expect(ctx).toContain('export function useAccessDenied(): boolean')
    expect(read('lib/entitlement/upgradeHref.ts')).toContain('/api/payments/upgrade?source=')
  })

  it('the approved expired UX is untouched', () => {
    // The AI teaser and the lead page's single standing notice.
    expect(read('components/ai/LeadIntelligenceCard.tsx')).toContain('return <LeadIntelligenceTeaser />')
    expect(read('components/leads/FollowUpControl.tsx')).toContain("source='lead_followup'")
    expect(read('components/calendar/CalendarView.tsx')).not.toContain('SubscriptionExpiredState')
  })
})
