// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { VERIFYING, resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * HEBREW BASELINE (i18n Phase F5): the trial gate the (app) layout renders —
 * `WorkspaceTeaser`, `TrialExpiredScreen` (with / without leads, every card
 * reactivation reason, the lead toasts' steps and their fallback name),
 * `WelcomeTrialModal` (every view, the admin-only line, the start button's
 * pending / refusal / network states), `ProActivationSuccess` — the card form's
 * holder-validation messages, `CardSetupVerifier` (verifying, confirmed per
 * purpose, sandbox, charges on / off, failed, timed out with / without a
 * callback), the REAL `/billing/success` page (every source, the stale-link
 * redirect) and its metadata, plus a JSON snapshot of the holder validation and
 * the recorded terms. Recorded BEFORE Phase F5; Hebrew must match afterwards.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/actions/trial', async () => (await import('./trialSupportMocks')).trialActionsModule())
vi.mock('@/actions/paymentMethod', async () => (await import('./trialSupportMocks')).paymentMethodActionsModule())
vi.mock('@/lib/facebook/pixelEvents', async () => (await import('./trialSupportMocks')).pixelEventsModule())
vi.mock('@/lib/i18n/preLoginServer', async () => (await import('./trialSupportMocks')).preLoginServerModule())

const renderToString = (node: ReactNode) => renderRaw(<>{node}</>).replaceAll('<!-- -->', '')

afterEach(() => {
  cleanup()
  resetTrialSupportEnv()
  vi.useRealTimers()
})

const flush = () => act(async () => {})

async function celebrating(node: ReactNode, activate = false) {
  const { ActivationCelebrationProvider, useActivationCelebration } = await import('@/components/trial/ActivationCelebrationContext')
  function Activate() {
    const { markActivated } = useActivationCelebration()
    useEffect(() => {
      if (activate) markActivated()
    }, [markActivated])
    return null
  }
  return (
    <ActivationCelebrationProvider>
      <Activate />
      {node}
    </ActivationCelebrationProvider>
  )
}

describe('Hebrew baseline — teaser and expired paywall', () => {
  test('WorkspaceTeaser', async () => {
    const { default: Teaser } = await import('@/components/trial/WorkspaceTeaser')
    expect(renderToString(<Teaser />)).toMatchSnapshot()
  })

  test('TrialExpiredScreen: no leads, leads, every reactivation reason', async () => {
    const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
    const out: Record<string, string> = {}
    out.noLeads = renderToString(<Screen />)
    out.leads = renderToString(<Screen leadCount={1234} leadNames={['דנה כהן', 'יוסי לוי']} />)
    for (const reason of ['declined', 'cancelled', 'ended'] as const) {
      out[reason] = renderToString(<Screen leadCount={2} leadNames={['דנה כהן']} cardReactivation={{ reason }} />)
    }
    expect(out).toMatchSnapshot()
  })

  test('the lead toasts step through the names, then stop; empty name falls back', async () => {
    vi.useFakeTimers()
    const { default: Toasts } = await import('@/components/trial/LeadEntryToasts')
    const { container } = render(<Toasts names={['דנה כהן', '', 'יוסי לוי', 'רביעי']} />)
    const steps: string[] = [container.innerHTML]
    for (const ms of [200, 2500, 500, 3100, 3100, 3100]) {
      await act(async () => {
        vi.advanceTimersByTime(ms)
      })
      steps.push(container.innerHTML)
    }
    expect(steps).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the welcome modal and the activation celebration', () => {
  const card = (stage: 'setup' | 'awaiting' | 'unavailable', canManageBilling = true) => ({
    defaultFullName: 'דנה כהן',
    defaultPhone: '0501234567',
    canManageBilling,
    stage,
  })

  test('every view', async () => {
    const { default: Modal } = await import('@/components/trial/WelcomeTrialModal')
    const out: Record<string, string> = {}
    const views: Record<string, ReactNode> = {
      setup: <Modal cardSetup={card('setup')} />,
      setupNotAdmin: <Modal cardSetup={card('setup', false)} />,
      awaiting: <Modal cardSetup={card('awaiting')} />,
      unavailable: <Modal cardSetup={card('unavailable')} />,
      later: <Modal trialOpensLater />,
      start: <Modal />,
    }
    for (const [name, node] of Object.entries(views)) {
      render(await celebrating(node))
      await flush()
      out[name] = document.body.innerHTML
      cleanup()
    }
    expect(out).toMatchSnapshot()
  })

  test('the start button: refused, network failure, pending, started', async () => {
    const { default: Modal } = await import('@/components/trial/WelcomeTrialModal')
    const out: Record<string, string> = {}
    const outcomes: Record<string, unknown> = {
      refused: { error: 'unauthorized' },
      refusedOther: { error: 'card_required' },
      network: () => Promise.reject(new Error('offline')),
      pending: () => new Promise(() => {}),
      started: { ok: true, started: true },
    }
    for (const [name, result] of Object.entries(outcomes)) {
      env.startTrial = result
      render(await celebrating(<Modal />))
      await flush()
      await act(async () => {
        fireEvent.click(screen.getByRole('button'))
      })
      out[name] = document.body.innerHTML
      cleanup()
    }
    expect(out).toMatchSnapshot('dom')
    expect(env.calls).toMatchSnapshot('calls')
  })

  test('ProActivationSuccess after a real activation, and nothing otherwise', async () => {
    const { default: Success } = await import('@/components/trial/ProActivationSuccess')
    render(await celebrating(<Success />))
    await flush()
    const idle = document.body.innerHTML
    cleanup()
    render(await celebrating(<Success />, true))
    await flush()
    expect({ idle, shown: document.body.innerHTML }).toMatchSnapshot()
  })

  test("the card form's holder refusals (Hebrew trial screens)", async () => {
    const { default: Form } = await import('@/components/trial/CardTrialSetupForm')
    const { validateCardHolder } = await import('@/lib/payments/cardTrial/cardHolder')
    const out: Record<string, string> = {}
    for (const input of [{ fullName: 'דנה', phone: '0501234567' }, { fullName: 'דנה כהן', phone: '123' }]) {
      const v = validateCardHolder(input)
      env.startCardSetup = { error: 'invalid_holder', field: (v as { field: string }).field, message: (v as { message: string }).message }
      const { container } = render(<Form purpose='trial_start' submitLabel='הוספת כרטיס והפעלת הניסיון' defaultFullName={input.fullName} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'הוספת כרטיס והפעלת הניסיון' }))
      })
      out[(v as { field: string }).field] = container.innerHTML
      cleanup()
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — the card return page', () => {
  const confirmed = (over: Record<string, unknown> = {}) => ({ ...VERIFYING, state: 'confirmed', callbackReceived: true, firstChargeAt: '2026-10-27T09:00:00.000Z', ...over })

  test('CardSetupVerifier: every state', async () => {
    const { default: Verifier } = await import('@/components/billing/CardSetupVerifier')
    const out: Record<string, string> = {}
    const cases: [string, 'card_trial' | 'card_update' | 'reactivate', unknown][] = [
      ['verifying', 'card_trial', VERIFYING],
      ['trial charges on', 'card_trial', confirmed({ chargesEnabled: true })],
      ['trial charges off', 'card_trial', confirmed()],
      ['trial no date', 'card_trial', confirmed({ firstChargeAt: null })],
      ['trial sandbox', 'card_trial', confirmed({ sandbox: true, chargesEnabled: true })],
      ['update', 'card_update', confirmed()],
      ['reactivate', 'reactivate', confirmed({ sandbox: true })],
      ['failed', 'card_trial', { ...VERIFYING, state: 'failed', callbackReceived: true }],
    ]
    for (const [name, purpose, state] of cases) {
      const { container } = render(<Verifier purpose={purpose} poll={async () => state as never} />)
      await flush()
      out[name] = container.innerHTML
      cleanup()
    }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    for (const callbackReceived of [false, true]) {
      const { container } = render(<Verifier purpose='card_trial' poll={async () => ({ ...VERIFYING, callbackReceived })} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })
      out[`timed out, callback ${callbackReceived}`] = container.innerHTML
      cleanup()
    }
    expect(out).toMatchSnapshot()
  })

  test('/billing/success: every source, the stale link, the title', async () => {
    const mod = await import('@/app/billing/success/page')
    const out: Record<string, string> = {}
    for (const source of ['card_trial', 'card_update', 'reactivate']) {
      out[source] = renderToString((await resolveAsync(mod.default({ searchParams: Promise.resolve({ source }) }))) as ReactNode)
    }
    for (const sp of [{}, { source: 'payment_link' }]) {
      await expect(resolveAsync(mod.default({ searchParams: Promise.resolve(sp) }))).rejects.toThrow('REDIRECT /settings/update_payment')
    }
    const m = mod as { metadata?: unknown; generateMetadata?: () => Promise<unknown> }
    out.metadata = JSON.stringify(m.generateMetadata ? await m.generateMetadata() : m.metadata)
    expect(out).toMatchSnapshot()
  })

  test('holder validation and recorded terms (JSON)', async () => {
    const { validateCardHolder } = await import('@/lib/payments/cardTrial/cardHolder')
    const terms = await import('@/lib/payments/cardTrial/terms')
    const inputs = [
      { fullName: 'דנה', phone: '0501234567' },
      { fullName: 'Dana 1', phone: '0501234567' },
      { fullName: 'דנה כהן', phone: '03-1234567' },
      { fullName: "דנה כ'הן", phone: '+972501234567' },
    ]
    expect(
      JSON.stringify(
        {
          holder: inputs.map(validateCardHolder),
          disclosure: terms.cardTrialDisclosureLines(),
          entitled: terms.entitledCardAddLines(),
          consent: terms.CARD_TRIAL_CONSENT_LABEL,
          storage: terms.CARD_STORAGE_CONSENT_LABEL,
          termsLine: terms.cardTrialTermsLine(),
        },
        null,
        2,
      ),
    ).toMatchSnapshot()
  })
})
