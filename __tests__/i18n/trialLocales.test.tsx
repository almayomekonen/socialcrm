// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { VERIFYING, resetTrialSupportEnv, trialSupportEnv as env } from './trialSupportEnv'
import { resolveAsync } from './dashboardHarness'
import { findHebrewLeaks } from './leakScan'

/**
 * Locale tests for the trial gate and the card return page (i18n Phase F5):
 * every screen in en / ar, leak-scanned (the card form's recorded terms only
 * inside declared Hebrew regions), each region declared, the price kept in ₪,
 * the "/month" suffix's margin mirrored in LTR only, the lead toast's fallback,
 * the dialogs (portalled) scanned in <body>, `/billing/success` following the
 * `ui_locale` hint (title too), and hydration he / en / ar.
 */

vi.mock('next/navigation', async () => (await import('./trialSupportMocks')).navigationModule())
vi.mock('@/actions/trial', async () => (await import('./trialSupportMocks')).trialActionsModule())
vi.mock('@/actions/paymentMethod', async () => (await import('./trialSupportMocks')).paymentMethodActionsModule())
vi.mock('@/lib/facebook/pixelEvents', async () => (await import('./trialSupportMocks')).pixelEventsModule())
vi.mock('@/lib/i18n/preLoginServer', async () => (await import('./trialSupportMocks')).preLoginServerModule())

type Loc = 'he' | 'en' | 'ar'
const NAME = [{ text: 'דנה כהן', reason: 'customer-data' as const }]
const flush = () => act(async () => {})
const regionOf = (el: Element | null) => [el?.getAttribute('lang') ?? null, el?.getAttribute('dir') ?? null]
const dir = (l: Loc) => (l === 'en' ? 'ltr' : 'rtl')

afterEach(() => {
  cleanup()
  resetTrialSupportEnv()
  vi.useRealTimers()
})

async function provided(locale: Loc, node: ReactNode, activate = false) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { ActivationCelebrationProvider, useActivationCelebration } = await import('@/components/trial/ActivationCelebrationContext')
  function Activate() {
    const { markActivated } = useActivationCelebration()
    useEffect(() => {
      if (activate) markActivated()
    }, [markActivated])
    return null
  }
  return (
    <I18nProvider locale={locale}>
      <ActivationCelebrationProvider>
        <Activate />
        {node}
      </ActivationCelebrationProvider>
    </I18nProvider>
  )
}

function outsideHebrewRegions(el: Element) {
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('[lang="he"]').forEach((n) => n.remove())
  return copy
}

for (const locale of ['en', 'ar'] as const) {
  const en = locale === 'en'

  describe(`trial gate in ${locale}`, () => {
    test('expired paywall: leads, plain, the toasts', async () => {
      const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
      const { container } = render(await provided(locale, <Screen leadCount={1234} leadNames={['דנה כהן', '']} />))
      const card = container.querySelector('.max-w-\\[440px\\]')!
      expect(regionOf(card)).toEqual([locale, dir(locale)])
      expect(findHebrewLeaks(container, NAME)).toEqual([])
      expect(card.querySelector('p > span.font-bold.text-white')!.textContent).toBe('1234')
      expect(card.textContent).toContain('₪89')
      const suffix = [...card.querySelectorAll('span')].find((s) => s.textContent === (en ? '/month' : '/شهريًا'))!
      expect(suffix.className).toContain(en ? 'ml-1' : 'mr-1')
      if (en) for (const s of ['Your leads are waiting', '1234 leads are waiting for you to get back to them', 'Unlimited AI in fast mode and smart mode', 'Upgrade now']) expect(container.textContent).toContain(s)
      // The toast's name is customer data with its own direction.
      expect(container.querySelector('h3')!.getAttribute('dir')).toBe('auto')
      cleanup()
      render(await provided(locale, <Screen leadCount={1} />))
      if (en) expect(document.body.textContent).toContain('1 lead is waiting for you to get back to it')
      cleanup()
      vi.useFakeTimers()
      const toasts = render(await provided(locale, <Screen leadCount={2} leadNames={['', 'דנה כהן']} />))
      expect(toasts.container.querySelector('h3')!.textContent).toBe(en ? 'Lead' : 'عميل محتمل')
      expect(toasts.container.querySelector('h3')!.hasAttribute('dir')).toBe(false)
    })

    test('expired paywall with the card form: chrome worded, recorded terms Hebrew in their regions', async () => {
      const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
      for (const reason of ['declined', 'cancelled', 'ended'] as const) {
        const { container } = render(await provided(locale, <Screen cardReactivation={{ reason }} />))
        expect(findHebrewLeaks(outsideHebrewRegions(container), []), reason).toEqual([])
        const hebrew = container.querySelectorAll('[lang="he"]')
        expect(hebrew.length, reason).toBe(3)
        for (const h of hebrew) expect(h.getAttribute('dir')).toBe('rtl')
        expect(screen.getByRole('button', { name: en ? 'Update payment method and continue' : 'تحديث وسيلة الدفع والمتابعة' })).toBeTruthy()
        cleanup()
      }
    })

    test('the holder refusals are worded; an unknown sentence is shown as received', async () => {
      const { default: Form } = await import('@/components/trial/CardTrialSetupForm')
      const { validateCardHolder } = await import('@/lib/payments/cardTrial/cardHolder')
      const bad = validateCardHolder({ fullName: 'דנה', phone: '0501234567' }) as { field: string; message: string }
      for (const [result, expected] of [
        [{ error: 'invalid_holder', field: bad.field, message: bad.message }, en ? 'Enter a first and last name, in letters only' : 'يرجى إدخال الاسم الأول واسم العائلة، بالأحرف فقط'],
        [{ error: 'invalid_holder', field: 'phone', message: 'הודעה אחרת' }, 'הודעה אחרת'],
      ] as const) {
        env.startCardSetup = result
        const { container } = render(await provided(locale, <Form purpose='trial_start' submitLabel='x' translated />))
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'x' })))
        expect(container.textContent).toContain(expected)
        cleanup()
      }
    })

    test('welcome modal: every view, the start states (portalled, scanned in <body>)', async () => {
      const { default: Modal } = await import('@/components/trial/WelcomeTrialModal')
      const card = (stage: 'setup' | 'awaiting' | 'unavailable', canManageBilling = true) => ({ defaultFullName: 'דנה כהן', canManageBilling, stage })
      for (const node of [<Modal cardSetup={card('setup', false)} />, <Modal cardSetup={card('awaiting')} />, <Modal cardSetup={card('unavailable')} />, <Modal trialOpensLater />, <Modal />]) {
        render(await provided(locale, node))
        await flush()
        const dialog = screen.getByRole('dialog')
        expect(regionOf(dialog)).toEqual([locale, dir(locale)])
        expect(findHebrewLeaks(document.body, [])).toEqual([])
        cleanup()
      }
      render(await provided(locale, <Modal cardSetup={card('setup')} />))
      await flush()
      expect(findHebrewLeaks(outsideHebrewRegions(document.body), NAME)).toEqual([])
      if (en) expect(document.body.textContent).toContain('Start with a 7-day trial')
      cleanup()
      for (const [result, text] of [
        [{ error: 'unauthorized' }, en ? 'Something went wrong, please try again' : 'حدث خطأ، يرجى المحاولة مرة أخرى'],
        [() => Promise.reject(new Error('x')), en ? 'A network error occurred, please try again' : 'حدث خطأ في الشبكة، يرجى المحاولة مرة أخرى'],
        [() => new Promise(() => {}), en ? 'Just a moment...' : 'لحظة من فضلك...'],
      ] as const) {
        env.startTrial = result
        render(await provided(locale, <Modal />))
        await flush()
        await act(async () => fireEvent.click(screen.getByRole('button', { name: en ? 'Start my Pro' : 'تفعيل Pro الخاص بي' })))
        expect(document.body.textContent).toContain(text)
        expect(findHebrewLeaks(document.body, [])).toEqual([])
        cleanup()
      }
    })

    test('activation celebration: worded, region declared, Escape closes and lands in the workspace', async () => {
      const { default: Success } = await import('@/components/trial/ProActivationSuccess')
      const main = document.createElement('main')
      main.id = 'main-content'
      main.tabIndex = -1
      document.body.appendChild(main)
      render(await provided(locale, <Success />, true))
      await flush()
      const dialog = screen.getByRole('dialog')
      expect(regionOf(dialog)).toEqual([locale, dir(locale)])
      expect(findHebrewLeaks(document.body, [])).toEqual([])
      expect(dialog.getAttribute('aria-labelledby')).toBe('pro-active-title')
      expect(screen.getByRole('button', { name: en ? 'Close' : 'إغلاق' })).toBeTruthy()
      if (en) expect(dialog.textContent).toContain('Your Pro is active')
      await act(async () => fireEvent.keyDown(dialog, { key: 'Escape' }))
      await act(async () => new Promise((r) => requestAnimationFrame(() => r(null))))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(main)
      main.remove()
    })
  })

  describe(`card return in ${locale}`, () => {
    const confirmed = (over: Record<string, unknown> = {}) => ({ ...VERIFYING, state: 'confirmed', callbackReceived: true, firstChargeAt: '2026-10-27T09:00:00.000Z', ...over })

    test('every state worded, region declared, ₪ and the numeric date kept', async () => {
      const { default: Verifier } = await import('@/components/billing/CardSetupVerifier')
      const cases: ['card_trial' | 'card_update' | 'reactivate', unknown, string][] = [
        ['card_trial', VERIFYING, en ? "Just a moment, we're verifying with the payment company" : 'لحظة من فضلك، نتحقق لدى شركة الدفع'],
        ['card_trial', confirmed({ chargesEnabled: true }), en ? 'The first charge, ₪89, will be made on 27/10/2026.' : '₪89'],
        ['card_trial', confirmed(), en ? 'The trial ends on 27/10/2026;' : '27/10/2026'],
        ['card_trial', confirmed({ sandbox: true }), 'Sandbox'],
        ['card_update', confirmed(), en ? 'Your card was updated' : 'تم تحديث البطاقة'],
        ['reactivate', confirmed(), en ? 'Your subscription was renewed' : 'تم تجديد الاشتراك'],
        ['card_trial', { ...VERIFYING, state: 'failed' }, en ? "We couldn't verify the card" : 'لم نتمكن من التحقق من البطاقة'],
      ]
      for (const [purpose, state, text] of cases) {
        const { container } = render(<Verifier purpose={purpose} locale={locale} poll={async () => state as never} />)
        await flush()
        expect(regionOf(container.firstElementChild)).toEqual([locale, dir(locale)])
        expect(findHebrewLeaks(container, [])).toEqual([])
        expect(container.textContent).toContain(text)
        cleanup()
      }
      vi.useFakeTimers({ shouldAdvanceTime: true })
      for (const callbackReceived of [false, true]) {
        const { container } = render(<Verifier purpose='card_trial' locale={locale} poll={async () => ({ ...VERIFYING, callbackReceived })} />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(31_000)
        })
        expect(container.textContent).toContain(en ? 'The confirmation is still being checked' : 'التأكيد لا يزال قيد الفحص')
        expect(findHebrewLeaks(container, [])).toEqual([])
        cleanup()
      }
    })
  })
}

describe('/billing/success follows the ui_locale hint', () => {
  test('page and title per locale; Hebrew byte-identical', async () => {
    const mod = await import('@/app/(he)/billing/success/page')
    const html = async () => renderRaw(<>{(await resolveAsync(mod.default({ searchParams: Promise.resolve({ source: 'card_trial' }) }))) as ReactNode}</>)
    const hebrew = await html()
    expect(hebrew).toContain('dir="rtl"')
    expect(hebrew).not.toContain('lang=')
    expect((await mod.generateMetadata()).title).toBe('הכרטיס נשמר')
    env.cookieLocale = 'en'
    expect(await html()).toContain('lang="en" dir="ltr"')
    expect((await mod.generateMetadata()).title).toBe('Card saved')
    env.cookieLocale = 'ar'
    expect(await html()).toContain('lang="ar" dir="rtl"')
    expect((await mod.generateMetadata()).title).toBe('تم حفظ البطاقة')
  })
})

describe('hydration', () => {
  for (const locale of ['he', 'en', 'ar'] as const) {
    test(`${locale}: the paywall and the card return page hydrate without a mismatch`, async () => {
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
      env.cookieLocale = locale
      const { default: Screen } = await import('@/components/trial/TrialExpiredScreen')
      const mod = await import('@/app/(he)/billing/success/page')
      const trees = [
        await provided(locale, <Screen leadCount={3} leadNames={['דנה כהן']} />),
        await provided(locale, <Screen cardReactivation={{ reason: 'declined' }} />),
        (await resolveAsync(mod.default({ searchParams: Promise.resolve({ source: 'card_update' }) }))) as ReactNode,
      ]
      for (const t of trees) {
        const container = document.createElement('div')
        container.innerHTML = renderRaw(<>{t}</>)
        document.body.appendChild(container)
        const errors: unknown[] = []
        const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
        const recoverable: unknown[] = []
        const root = await act(async () => hydrateRoot(container, <>{t}</>, { onRecoverableError: (e) => void recoverable.push(e) }))
        expect(recoverable).toEqual([])
        expect(errors.filter((e) => String(e).match(/hydrat|did not match/i))).toEqual([])
        act(() => root.unmount())
        spy.mockRestore()
        container.remove()
      }
    })
  }
})
