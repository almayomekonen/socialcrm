// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { VERIFYING, resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'
import { resolveAsync } from './dashboardHarness'

/**
 * Behaviour is language-independent (i18n Phase F5). The same taps in he / en /
 * ar send IDENTICAL action arguments, navigations, toast kinds and pixel /
 * telemetry calls; the card form posts the same holder and consents and shows
 * the recorded terms byte-identical; the verifier polls on the same cadence
 * and stops at the same bound; `/billing/success` redirects the same; the
 * welcome modal stays non-dismissible; controls keep their classes.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/actions/trial', async () => (await import('./trialSupportMocks')).trialActionsModule())
vi.mock('@/actions/paymentMethod', async () => (await import('./trialSupportMocks')).paymentMethodActionsModule())
vi.mock('@/actions/support/requests', async () => (await import('./trialSupportMocks')).supportActionsModule())
vi.mock('@/lib/facebook/pixelEvents', async () => (await import('./trialSupportMocks')).pixelEventsModule())
vi.mock('@/lib/toast', async () => (await import('./trialSupportMocks')).toastModule())
vi.mock('@/lib/i18n/preLoginServer', async () => (await import('./trialSupportMocks')).preLoginServerModule())

const LOCALES = ['he', 'en', 'ar'] as const
type Loc = (typeof LOCALES)[number]

afterEach(() => {
  cleanup()
  resetTrialSupportEnv()
  vi.useRealTimers()
})

async function provided(locale: Loc, node: ReactNode) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { ActivationCelebrationProvider } = await import('@/components/trial/ActivationCelebrationContext')
  return (
    <I18nProvider locale={locale}>
      <ActivationCelebrationProvider>{node}</ActivationCelebrationProvider>
    </I18nProvider>
  )
}

/** Calls with toast MESSAGES dropped (they are worded per language); everything else compared exactly. */
const comparable = () => env.calls.map(([n, v]) => (n === 'toast' ? [n, (v as { kind: string }).kind] : [n, v]))

/** Run `scenario` once per locale and return what each sent. */
async function perLocale(scenario: (locale: Loc) => Promise<void>) {
  const out: Record<string, unknown> = {}
  for (const locale of LOCALES) {
    resetTrialSupportEnv()
    await scenario(locale)
    out[locale] = { calls: comparable() }
    cleanup()
  }
  return out as Record<Loc, unknown>
}

const submit = (form: Element) => act(async () => void fireEvent.submit(form))

describe('support centre controls', () => {
  test('the request form and the reply box send the same thing in every language', async () => {
    const { default: Form } = await import('@/components/support/SupportRequestForm')
    const { default: Reply } = await import('@/components/support/SupportReplyBox')
    const sent = await perLocale(async (locale) => {
      for (const kind of ['problem', 'question'] as const) {
        const { container, unmount } = render(await provided(locale, <Form kind={kind} />))
        fireEvent.change(container.querySelector('textarea')!, { target: { value: 'הוואטסאפ לא מתחבר' } })
        await submit(container.querySelector('form')!)
        unmount()
      }
      env.createResult = { ok: false, reason: 'rate_limited' }
      const refused = render(await provided(locale, <Form kind='problem' />))
      await submit(refused.container.querySelector('form')!)
      expect(refused.container.querySelector('[role="alert"]')).toBeTruthy()
      refused.unmount()
      const reply = render(await provided(locale, <Reply requestId={41} isResolved />))
      fireEvent.change(reply.container.querySelector('textarea')!, { target: { value: 'עדיין לא עובד' } })
      await submit(reply.container.querySelector('form')!)
      // Same field: id, required, length cap.
      const area = reply.container.querySelector('textarea')!
      expect([area.id, area.required, area.maxLength]).toEqual(['support-reply', true, 5000])
    })
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(JSON.stringify(sent.he)).toContain('createSupportRequestAction')
    expect(JSON.stringify(sent.he)).toContain('/support/requests/41')
  })

  test('the guide search navigates to the same URLs', async () => {
    const { default: Search } = await import('@/components/support/SupportSearch')
    const sent = await perLocale(async (locale) => {
      const { container } = render(await provided(locale, <Search initialQuery='whatsapp' />))
      await submit(container.querySelector('form')!)
      fireEvent.change(container.querySelector('input')!, { target: { value: '  ' } })
      await submit(container.querySelector('form')!)
    })
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
  })
})

describe('trial gate', () => {
  test('the welcome modal starts the trial with the same calls; it cannot be dismissed', async () => {
    const { default: Modal } = await import('@/components/trial/WelcomeTrialModal')
    const sent = await perLocale(async (locale) => {
      for (const result of [{ error: 'unauthorized' }, () => Promise.reject(new Error('x')), { ok: true, started: true }]) {
        env.startTrial = result
        render(await provided(locale, <Modal />))
        await act(async () => {})
        await act(async () => void fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }))
        expect(screen.getByRole('dialog')).toBeTruthy()
        await act(async () => void fireEvent.click(screen.getAllByRole('button')[0]))
        cleanup()
      }
    })
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(JSON.stringify(sent.he)).toContain('trackStartTrial')
  })

  test('the card form posts the same holder and consents; the recorded terms are byte-identical', async () => {
    const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
    const terms = await import('@/lib/payments/cardTrial/terms')
    const recorded: Record<string, string[]> = {}
    const classes: Record<string, string[]> = {}
    const sent = await perLocale(async (locale) => {
      const { container } = render(await provided(locale, <Screen cardReactivation={{ reason: 'declined' }} />))
      const inputs = container.querySelectorAll('input:not([type="checkbox"])')
      fireEvent.change(inputs[0], { target: { value: 'דנה כהן' } })
      fireEvent.change(inputs[1], { target: { value: '0501234567' } })
      for (const box of container.querySelectorAll('input[type="checkbox"]')) fireEvent.click(box)
      const button = [...container.querySelectorAll('button')].at(-1)!
      classes[locale] = [...container.querySelectorAll('button, a, input')].map((el) => el.className)
      // Hebrew renders the terms with no region; en / ar inside [lang="he"]. Compare the sentences themselves.
      const lines = [...container.querySelectorAll('p.leading-relaxed.text-gray-700, label')].map((el) => el.textContent ?? '')
      const known = [...terms.cardTrialDisclosureLines(), terms.CARD_TRIAL_CONSENT_LABEL, terms.CARD_STORAGE_CONSENT_LABEL]
      recorded[locale] = lines.filter((l) => known.includes(l))
      await act(async () => void fireEvent.click(button))
    })
    expect(sent.en).toEqual(sent.he)
    expect(sent.ar).toEqual(sent.he)
    expect(JSON.stringify(sent.he)).toContain('"purpose":"reactivate"')
    expect(recorded.he).toHaveLength(6)
    expect(recorded.en).toEqual(recorded.he)
    expect(recorded.ar).toEqual(recorded.he)
    for (const line of terms.cardTrialDisclosureLines()) expect(recorded.he).toContain(line)
    expect(recorded.he).toContain(terms.CARD_TRIAL_CONSENT_LABEL)
    expect(recorded.he).toContain(terms.CARD_STORAGE_CONSENT_LABEL)
    expect(classes.en).toEqual(classes.he)
    expect(classes.ar).toEqual(classes.he)
  })

  test('the upgrade button goes to the same place in every language', async () => {
    const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
    const targets: string[] = []
    const location = { href: '' }
    vi.stubGlobal('location', location)
    for (const locale of LOCALES) {
      const { container } = render(await provided(locale, <Screen leadCount={2} />))
      fireEvent.click(container.querySelector('button')!)
      targets.push(location.href)
      cleanup()
    }
    vi.unstubAllGlobals()
    expect(new Set(targets).size).toBe(1)
    expect(targets[0]).toBeTruthy()
  })
})

describe('card return', () => {
  test('the verifier polls on the same cadence, stops at the same bound, and goes to the same places', async () => {
    const { default: Verifier } = await import('@/components/billing/CardSetupVerifier')
    const counts: number[] = []
    const navigations: string[][] = []
    for (const locale of LOCALES) {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const assign = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign })
      const poll = vi.fn(async () => ({ ...VERIFYING, callbackReceived: true }))
      const { container } = render(<Verifier purpose='card_trial' locale={locale} poll={poll} />)
      await act(async () => void (await vi.advanceTimersByTimeAsync(31_000)))
      const atBound = poll.mock.calls.length
      await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)))
      expect(poll.mock.calls.length).toBe(atBound)
      counts.push(atBound)
      for (const b of container.querySelectorAll('button')) fireEvent.click(b)
      navigations.push(assign.mock.calls.map((c) => c[0]))
      vi.unstubAllGlobals()
      vi.useRealTimers()
      cleanup()
    }
    expect(new Set(counts).size).toBe(1)
    expect(navigations[1]).toEqual(navigations[0])
    expect(navigations[2]).toEqual(navigations[0])
    expect(navigations[0]).toEqual(['/settings/update_payment', '/dashboard'])
  })

  test('/billing/success redirects a stale link the same way in every language', async () => {
    const mod = await import('@/app/billing/success/page')
    for (const locale of LOCALES) {
      env.cookieLocale = locale
      for (const sp of [{}, { source: 'payment_link' }, { source: ['x'] }]) {
        await expect(resolveAsync(mod.default({ searchParams: Promise.resolve(sp) }))).rejects.toThrow('REDIRECT /settings/update_payment')
      }
    }
  })
})
