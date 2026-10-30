// @vitest-environment jsdom
/**
 * Hebrew baseline for the education layer (product tours, the Help spotlight,
 * the Help menu, the "no leads yet" notice, Copilot's "Show me" button and the
 * guide offers), recorded on UNMODIFIED code before Phase E6. Every tour is
 * walked through the REAL Driver.js, step by step, so the popover markup
 * (title, body, progress, buttons, dir, role, accessible name) is pinned.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { dismissWithFooterButton, mountTourTargets, popover, reduceMotion, settle, walkTour } from './educationHarness'

vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/lib/css/education.css', () => ({}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/leads',
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/actions/education/recordEducationEvent', () => ({ recordEducationEvent: vi.fn(() => Promise.resolve()) }))

const { runTour, runOverviewIntro, stopActiveTour } = await import('@/components/education/runTour')
const { allTours } = await import('@/lib/education/registry')
const { __resetTourLockForTests } = await import('@/lib/education/tourLock')
const { EducationProvider, useEducation } = await import('@/components/education/EducationProvider')
const { default: ProductTourHost } = await import('@/components/education/ProductTourHost')
const { default: LeadsTourEmptyNotice } = await import('@/components/education/LeadsTourEmptyNotice')
const { default: ShowMeButton } = await import('@/components/education/ShowMeButton')
const { offerEducationForGuide } = await import('@/lib/education/offer')


beforeEach(() => {
  __resetTourLockForTests()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/leads')
  reduceMotion()
})

afterEach(() => {
  stopActiveTour()
  cleanup()
  __resetTourLockForTests()
  document.body.innerHTML = ''
})

describe('every tour, every step (real Driver.js)', () => {
  for (const def of allTours()) {
    test(`${def.id} — walked to the end`, async () => {
      mountTourTargets()
      const { steps, outcome } = await walkTour(() => runTour(def), def.steps.length)
      expect(outcome).toEqual({ status: 'completed', lastStep: def.steps.length - 1 })
      expect(steps.join('\n\n')).toMatchSnapshot()
    })

    test(`${def.id} — skipped at the first step`, async () => {
      mountTourTargets()
      const { html, outcome } = await dismissWithFooterButton(() => runTour(def))
      expect(outcome).toEqual({ status: 'dismissed', lastStep: 0 })
      expect(html).toContain('דלג')
    })
  }

  test('a tour whose targets are partly missing shows only the present steps (pipeline without lead-open)', async () => {
    mountTourTargets()
    document.querySelector('[data-edu="lead-open"]')?.remove()
    const def = allTours().find((t) => t.id === 'pipeline')!
    const { steps } = await walkTour(() => runTour(def), def.steps.length - 1)
    expect(steps.join('\n\n')).toMatchSnapshot()
  })
})

describe('the first-time Help spotlight', () => {
  test('accepted with its start button', async () => {
    mountTourTargets()
    const { steps, outcome } = await walkTour(() => runOverviewIntro(), 1)
    expect(outcome).toBe('accepted')
    expect(steps[0]).toMatchSnapshot()
  })

  test('declined with "maybe later"', async () => {
    mountTourTargets()
    const { html, outcome } = await dismissWithFooterButton(() => runOverviewIntro())
    expect(outcome).toBe('declined')
    expect(html).toContain('אולי אחר כך')
  })
})

function OpenHelp() {
  const { openHelp } = useEducation()
  return (
    <button type='button' onClick={openHelp}>
      open-help
    </button>
  )
}

describe('the Help menu and the "no leads" notice', () => {
  test('the Help menu (Copilot on and off)', async () => {
    for (const copilotEnabled of [true, false]) {
      render(
        <EducationProvider userId={5} surface='desktop' copilotEnabled={copilotEnabled} toursEnabled>
          <OpenHelp />
          <ProductTourHost />
        </EducationProvider>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'open-help' }))
      const dialog = await screen.findByRole('dialog', { name: 'עזרה' })
      expect(dialog.outerHTML).toMatchSnapshot(`help menu, copilot ${copilotEnabled ? 'on' : 'off'}`)
      cleanup()
    }
  })

  test('the "no leads yet" notice (pipeline tour on an empty workspace)', async () => {
    render(<LeadsTourEmptyNotice onDismiss={() => {}} onAddLead={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'אין כרגע לידים' })
    expect(dialog.outerHTML).toMatchSnapshot()
  })

  test('the notice opens from Help → the pipeline tour when the workspace is empty', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-leads-empty></div>')
    render(
      <EducationProvider userId={5} surface='desktop' copilotEnabled toursEnabled>
        <OpenHelp />
        <ProductTourHost />
      </EducationProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'open-help' }))
    fireEvent.click(await screen.findByRole('button', { name: 'סיור בלידים' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'אין כרגע לידים' })).toBeTruthy())
    expect(popover()).toBeNull()
  })
})

describe('Copilot pieces (AI surface, recorded to prove they stay Hebrew)', () => {
  test('"Show me" button', () => {
    const { container } = render(<ShowMeButton action='open_pipeline_tour' />)
    expect(container.innerHTML).toMatchSnapshot()
  })

  test('guide offers', () => {
    const ctx = { copilotEnabled: true, whatsappConnected: true, facebookConnected: true, facebookNeedsReconnect: false }
    const offers = [
      offerEducationForGuide({ id: 'guide.connectWhatsapp', answer: 'x', educationAction: 'open_whatsapp_tour' }, ctx),
      offerEducationForGuide({ id: 'guide.connectFacebook', answer: 'x', educationAction: 'open_facebook_tour' }, ctx),
    ]
    expect(JSON.stringify(offers, null, 2)).toMatchSnapshot()
  })
})

describe('tour starts land in one language session', () => {
  test('a started tour can be stopped and a new one started', async () => {
    mountTourTargets()
    const lead = allTours().find((t) => t.id === 'lead')!
    const pending = runTour(lead)
    await waitFor(() => expect(popover()).not.toBeNull())
    await settle()
    act(() => stopActiveTour())
    expect(await pending).toEqual({ status: 'dismissed', lastStep: 0 })
  })
})
