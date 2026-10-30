// @vitest-environment jsdom
/**
 * Product tours in en / ar (Phase E6), through the REAL Driver.js: every tour,
 * every step, the Help spotlight, the Help menu and the "no leads yet" notice —
 * translated words, the popover declaring its own language (it renders in
 * <body>, outside every island), no Hebrew left, the same steps and outcomes
 * as Hebrew, the same stored record, a language switch in one session, Escape
 * and focus return. The Hebrew output is pinned by educationHebrewBaseline.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { findHebrewLeaks } from './leakScan'
import { dismissWithFooterButton, mountTourTargets, popover, reduceMotion, settle, walkTour } from './educationHarness'

vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/lib/css/education.css', () => ({}))
const nav = vi.hoisted(() => ({ push: vi.fn(), pathname: '/leads' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/actions/education/recordEducationEvent', () => ({ recordEducationEvent: vi.fn(() => Promise.resolve()) }))

const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
const { default: EducationMount } = await import('@/components/education/EducationMount')
const { useEducation } = await import('@/components/education/EducationProvider')
const { runTour, runOverviewIntro, stopActiveTour } = await import('@/components/education/runTour')
const { allTours, getTour } = await import('@/lib/education/registry')
const { __resetTourLockForTests } = await import('@/lib/education/tourLock')
const { emptyState, readState, writeState } = await import('@/lib/education/storage')

type L = 'he' | 'en' | 'ar'
const USER = 31

function Controls() {
  const { openHelp, startTour } = useEducation()
  return (
    <>
      <button type='button' onClick={openHelp}>
        open-help
      </button>
      <button type='button' onClick={() => startTour('lead', { force: true, source: 'help' })}>
        start-lead
      </button>
    </>
  )
}

/** The real island: the provider and EducationMount (which pushes the language to the popovers). */
function Island({ locale, children }: { locale: L; children?: ReactNode }) {
  return (
    <I18nProvider locale={locale}>
      <EducationMount userId={USER} surface='desktop' copilotEnabled toursEnabled={false}>
        <Controls />
        {children}
      </EducationMount>
    </I18nProvider>
  )
}

function leaks(el: Element | null) {
  if (!el) throw new Error('nothing rendered')
  return findHebrewLeaks(el, [])
}

beforeEach(() => {
  __resetTourLockForTests()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/leads')
  nav.pathname = '/leads'
  nav.push.mockClear()
  writeState(USER, emptyState())
  reduceMotion()
})

afterEach(() => {
  stopActiveTour()
  cleanup()
  __resetTourLockForTests()
  document.body.innerHTML = ''
})

const EXPECT = {
  en: { lang: 'en', dir: 'ltr', progress: /^1 of \d+$/, next: 'Next', skip: 'Skip', close: 'Close' },
  ar: { lang: 'ar', dir: 'rtl', progress: /^1 من \d+$/, next: 'التالي', skip: 'تخطٍّ', close: 'إغلاق' },
} as const

describe.each(['en', 'ar'] as const)('%s', (locale) => {
  const want = EXPECT[locale]

  for (const def of allTours()) {
    test(`${def.id}: every step translated, declared, no Hebrew; same outcome as Hebrew`, async () => {
      render(<Island locale={locale} />)
      mountTourTargets()
      const pending = runTour(def)
      await waitFor(() => expect(popover()).not.toBeNull(), { timeout: 3000 })
      await settle()
      const el = popover()!
      expect(el.getAttribute('lang')).toBe(want.lang)
      expect(el.getAttribute('dir')).toBe(want.dir)
      expect(el.querySelector('.driver-popover-progress-text')?.textContent).toMatch(want.progress)
      expect(el.querySelector('.edu-popover-skip')?.textContent).toBe(want.skip)
      expect(el.querySelector('.driver-popover-close-btn')?.getAttribute('aria-label')).toBe(want.close)
      expect(el.getAttribute('aria-label')).toBe(el.querySelector('.driver-popover-title')?.textContent)
      // Walk the rest of the tour through its own buttons.
      const seen: string[] = []
      for (let i = 0; i < def.steps.length; i++) {
        await settle()
        expect(leaks(popover()), `${def.id} step ${i}`).toEqual([])
        expect(popover()?.getAttribute('lang')).toBe(want.lang)
        seen.push(popover()!.querySelector('.driver-popover-title')!.textContent!)
        fireEvent.click(popover()!.querySelector('.driver-popover-next-btn')!)
      }
      expect(await pending).toEqual({ status: 'completed', lastStep: def.steps.length - 1 })
      expect(seen).toHaveLength(def.steps.length)
    })
  }

  test('the close button is named in the interface language', async () => {
    render(<Island locale={locale} />)
    mountTourTargets()
    const { html } = await dismissWithFooterButton(() => runTour(getTour('lead')!))
    expect(html).toContain(`aria-label="${want.close}"`)
  })

  test('Escape dismisses a tour exactly as in Hebrew', async () => {
    render(<Island locale={locale} />)
    mountTourTargets()
    const pending = runTour(getTour('lead')!)
    await waitFor(() => expect(popover()).not.toBeNull())
    await settle()
    fireEvent.keyUp(window, { key: 'Escape' })
    expect(await pending).toEqual({ status: 'dismissed', lastStep: 0 })
  })

  test('the Help spotlight: translated, declared, accepted like Hebrew', async () => {
    render(<Island locale={locale} />)
    mountTourTargets()
    const accepted = await walkTour(() => runOverviewIntro(), 1)
    expect(accepted.outcome).toBe('accepted')
    expect(accepted.steps[0]).toContain(`lang="${want.lang}"`)
    // Scan the recorded popover detached from the page (a copy in <body> would be found as the popover).
    const scan = document.createElement('div')
    scan.innerHTML = accepted.steps[0]
    expect(findHebrewLeaks(scan, [])).toEqual([])
  })

  test('the Help spotlight: declined with "maybe later"', async () => {
    render(<Island locale={locale} />)
    mountTourTargets()
    const declined = await dismissWithFooterButton(() => runOverviewIntro())
    expect(declined.outcome).toBe('declined')
    expect(declined.html).toContain(locale === 'en' ? '>Maybe later<' : '>ربما لاحقًا<')
  })

  test('a tour started from the provider stores exactly what Hebrew stores', async () => {
    nav.pathname = '/clients/1/summary'
    window.history.replaceState({}, '', '/clients/1/summary')
    render(<Island locale={locale} />)
    mountTourTargets()
    fireEvent.click(screen.getByRole('button', { name: 'start-lead' }))
    await waitFor(() => expect(popover()).not.toBeNull(), { timeout: 3000 })
    for (let i = 0; i < 2; i++) {
      await settle()
      fireEvent.click(popover()!.querySelector('.driver-popover-next-btn')!)
    }
    await waitFor(() => expect(readState(USER).tours.lead?.status).toBe('completed'))
    const { at, ...record } = readState(USER).tours.lead!
    expect(at).toBeTruthy()
    expect(record).toEqual({ version: 1, status: 'completed', lastStep: 1 })
  })

  test('the Help menu: translated, declared, named buttons, Escape returns focus', async () => {
    render(<Island locale={locale} />)
    const opener = screen.getByRole('button', { name: 'open-help' })
    opener.focus()
    fireEvent.click(opener)
    const title = locale === 'en' ? 'Help' : 'مساعدة'
    const dialog = await screen.findByRole('dialog', { name: title })
    expect(dialog.getAttribute('lang')).toBe(want.lang)
    expect(dialog.querySelector('.grid')?.getAttribute('lang')).toBe(want.lang)
    expect(dialog.querySelector('.grid')?.getAttribute('dir')).toBe(want.dir)
    expect(leaks(dialog)).toEqual([])
    for (const a of dialog.querySelectorAll('a, button')) expect((a.textContent || a.getAttribute('aria-label') || '').trim()).not.toBe('')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  test('Help → the leads tour on an empty workspace: the notice, translated; add-lead clicks the existing control', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-leads-empty><button type="button" data-add-lead>x</button></div>')
    const add = vi.fn()
    document.querySelector('[data-add-lead]')!.addEventListener('click', add)
    render(<Island locale={locale} />)
    fireEvent.click(screen.getByRole('button', { name: 'open-help' }))
    fireEvent.click(await screen.findByRole('button', { name: locale === 'en' ? 'Leads tour' : 'جولة في العملاء المحتملين' }))
    const dialog = await screen.findByRole('dialog', { name: locale === 'en' ? 'No leads yet' : 'لا يوجد عملاء محتملون حاليًا' })
    expect(dialog.getAttribute('lang')).toBe(want.lang)
    expect(leaks(dialog)).toEqual([])
    expect(popover()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add lead' : 'إضافة عميل محتمل' }))
    expect(add).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('Help menu buttons start the same tours / routes as in Hebrew', async () => {
    nav.pathname = '/dashboard'
    render(<Island locale={locale} />)
    fireEvent.click(screen.getByRole('button', { name: 'open-help' }))
    fireEvent.click(await screen.findByRole('button', { name: locale === 'en' ? 'Leads tour' : 'جولة في العملاء المحتملين' }))
    expect(nav.push).toHaveBeenCalledWith('/leads?tour=pipeline')
  })
})

describe('one session, three languages', () => {
  test('switching the interface language changes the next tour; Hebrew is back to the original', async () => {
    const { rerender } = render(<Island locale='en' />)
    mountTourTargets()
    const lead = getTour('lead')!
    const titleOf = async () => {
      const { html, outcome } = await dismissWithFooterButton(() => runTour(lead))
      expect(outcome).toEqual({ status: 'dismissed', lastStep: 0 })
      return html
    }
    expect(await titleOf()).toContain('>Lead status<')
    rerender(<Island locale='ar' />)
    expect(await titleOf()).toContain('>حالة العميل المحتمل<')
    rerender(<Island locale='he' />)
    const he = await titleOf()
    expect(he).toContain('>סטטוס הליד<')
    expect(he).toContain('dir="rtl"')
    expect(he).not.toContain('lang=')
    expect(he).toContain('aria-label="Close"')
  })

  test('outside the island (no provider) a tour is Hebrew', async () => {
    mountTourTargets()
    const { html } = await dismissWithFooterButton(() => runTour(getTour('lead')!))
    expect(html).toContain('>סטטוס הליד<')
    expect(html).not.toContain('lang=')
  })
})

