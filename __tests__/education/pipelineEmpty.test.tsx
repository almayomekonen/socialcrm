// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { readFileSync } from 'node:fs'
import { type ReactNode } from 'react'
import { getTour } from '@/lib/education/registry'
import { LEAD_OPEN_EDU } from '@/lib/education/types'
import { emptyState, readState, writeState } from '@/lib/education/storage'
import { __resetTourLockForTests, isTourLockHeld } from '@/lib/education/tourLock'

const driverState = vi.hoisted(() => ({
  config: null as any,
  instance: null as any,
  calls: 0,
}))

vi.mock('driver.js', () => ({
  driver: (config: any) => {
    driverState.calls += 1
    driverState.config = config
    driverState.instance = {
      drive: vi.fn(),
      destroy: vi.fn(() => {
        config.onDestroyed?.()
      }),
      getActiveIndex: () => 0,
      isLastStep: () => true,
    }
    return driverState.instance
  },
}))

vi.mock('driver.js/dist/driver.css', () => ({}))
vi.mock('@/lib/css/education.css', () => ({}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/leads',
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/actions/education/recordEducationEvent', () => ({
  recordEducationEvent: vi.fn(() => Promise.resolve()),
}))

import { runTour } from '@/components/education/runTour'
import { EducationProvider, useEducation } from '@/components/education/EducationProvider'
import ProductTourHost from '@/components/education/ProductTourHost'
import { openExistingAddLead } from '@/components/education/LeadsTourEmptyNotice'

const USER_ID = 44
const PIPELINE_TITLES = ['הרשימה', 'סטטוסים', 'פתיחת ליד', 'ליד חדש', 'זה כל הרעיון'] as const
const OVERVIEW_TITLES = [
  'היום',
  'לידים',
  'לקוחות',
  'שיחות',
  'עסקאות',
  'ביצועים',
  'משימות',
  'פגישות',
  'הגדרות',
  'הסרגל העליון',
  'העוזר החכם',
  'התראות',
  'זהו, עכשיו אתה בעניינים',
] as const

function mount(html: string) {
  document.body.insertAdjacentHTML('beforeend', html)
}

function mountLeadsTable(opts: { open?: boolean } = {}) {
  const open = opts.open === false ? '' : `<a data-edu="${LEAD_OPEN_EDU}" href="/clients/1/summary">ליד</a>`
  mount(`
    <div data-edu="leads-table"></div>
    <div data-edu="lead-status-tabs"></div>
    <button type="button" data-edu="leads-add">ליד חדש</button>
    ${open}
  `)
}

function Starter() {
  const { startTour } = useEducation()
  return (
    <button type='button' onClick={() => startTour('pipeline', { force: true, source: 'help' })}>
      start-pipeline
    </button>
  )
}

function OpenHelp() {
  const { openHelp } = useEducation()
  return (
    <button type='button' onClick={openHelp}>
      open-help
    </button>
  )
}

function renderEducation(children: ReactNode, opts?: { surface?: 'desktop' | 'mobile' }) {
  return render(
    <EducationProvider
      userId={USER_ID}
      surface={opts?.surface ?? 'desktop'}
      copilotEnabled
      toursEnabled
    >
      {children}
      <ProductTourHost />
    </EducationProvider>,
  )
}

beforeEach(() => {
  __resetTourLockForTests()
  driverState.config = null
  driverState.instance = null
  driverState.calls = 0
  document.body.innerHTML = ''
  writeState(USER_ID, emptyState())
  window.history.replaceState({}, '', '/leads')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({ matches: false, addListener: () => {}, removeListener: () => {} }),
  })
})

afterEach(() => {
  cleanup()
  __resetTourLockForTests()
  document.body.innerHTML = ''
})

describe('zero leads — do not start Driver.js', () => {
  it('does not load Driver.js, acquire the tour lock, or show the closing step', async () => {
    mount(`<div data-leads-empty></div>`)
    const onEmpty = vi.fn()
    const outcome = await runTour(getTour('pipeline')!, { onEmptyWorkspace: onEmpty })
    expect(outcome).toBeNull()
    expect(onEmpty).toHaveBeenCalledTimes(1)
    expect(driverState.calls).toBe(0)
    expect(driverState.config).toBeNull()
    expect(isTourLockHeld()).toBe(false)
  })

  it('shows the empty-state message from Help → סיור בלידים', async () => {
    mount(`<div data-leads-empty></div>`)
    renderEducation(<OpenHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'open-help' }))
    fireEvent.click(screen.getByRole('button', { name: 'סיור בלידים' }))
    expect(await screen.findByRole('dialog', { name: 'אין כרגע לידים' })).toBeInTheDocument()
    expect(screen.getByText('אין כרגע לידים')).toBeInTheDocument()
    expect(screen.getByText('כדי להתחיל את סיור הלידים, הוסף לפחות ליד אחד.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוסף ליד' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הבנתי' })).toBeInTheDocument()
    expect(screen.queryByText('זה כל הרעיון')).toBeNull()
    expect(screen.queryByText('1 מתוך 1')).toBeNull()
    expect(driverState.calls).toBe(0)
    expect(isTourLockHeld()).toBe(false)
  })

  it('does not mark the Leads Tour completed or dismissed', async () => {
    mount(`<div data-leads-empty></div>`)
    renderEducation(<Starter />)
    fireEvent.click(screen.getByRole('button', { name: 'start-pipeline' }))
    expect(await screen.findByText('אין כרגע לידים')).toBeInTheDocument()
    expect(readState(USER_ID).tours.pipeline).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'הבנתי' }))
    await waitFor(() => expect(screen.queryByText('אין כרגע לידים')).toBeNull())
    expect(readState(USER_ID).tours.pipeline).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'start-pipeline' }))
    expect(await screen.findByText('אין כרגע לידים')).toBeInTheDocument()
    expect(readState(USER_ID).tours.pipeline).toBeUndefined()
  })

  it('closes on הבנתי without starting Driver.js', async () => {
    mount(`<div data-leads-empty></div>`)
    renderEducation(<Starter />)
    fireEvent.click(screen.getByRole('button', { name: 'start-pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'הבנתי' }))
    await waitFor(() => expect(screen.queryByText('אין כרגע לידים')).toBeNull())
    expect(driverState.calls).toBe(0)
    expect(isTourLockHeld()).toBe(false)
  })
})

describe('הוסף ליד uses the existing Add Lead control', () => {
  it('clicks the first-run Add Lead control and does not mount ClientFormPop', async () => {
    const existing = vi.fn()
    renderEducation(
      <div data-leads-empty=''>
        <button type='button' data-add-lead='' onClick={existing}>
          existing-add
        </button>
        <Starter />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'start-pipeline' }))
    fireEvent.click(await screen.findByRole('button', { name: 'הוסף ליד' }))
    expect(existing).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('אין כרגע לידים')).toBeNull())
    const notice = readFileSync('components/education/LeadsTourEmptyNotice.tsx', 'utf8')
    expect(notice).not.toContain('ClientFormPop')
    expect(notice).not.toContain('driver.js')
    expect(notice).toContain('openExistingAddLead')
  })

  it('clicks data-edu="leads-add" when that existing toolbar control is present', () => {
    const toolbar = vi.fn()
    const btn = document.createElement('button')
    btn.setAttribute('data-edu', 'leads-add')
    btn.addEventListener('click', toolbar)
    document.body.appendChild(btn)
    expect(openExistingAddLead()).toBe(true)
    expect(toolbar).toHaveBeenCalledTimes(1)
  })
})

describe('one or more leads — existing 5-step Leads Tour', () => {
  it('starts Driver.js with the existing sequence when lead-open is present', async () => {
    mountLeadsTable()
    const pending = runTour(getTour('pipeline')!)
    await vi.waitFor(() => expect(driverState.config).toBeTruthy())
    expect(driverState.calls).toBe(1)
    expect(isTourLockHeld()).toBe(true)
    expect(driverState.config.steps.map((s: { popover: { title: string } }) => s.popover.title)).toEqual([
      ...PIPELINE_TITLES,
    ])
    driverState.instance.destroy()
    await expect(pending).resolves.toEqual({ status: 'dismissed', lastStep: 0 })
  })

  it('does not change the registered Leads or Overview sequences', () => {
    expect(getTour('pipeline')!.steps.map((s) => s.title)).toEqual([...PIPELINE_TITLES])
    expect(getTour('overview')!.steps.map((s) => s.title)).toEqual([...OVERVIEW_TITLES])
    expect(getTour('overview')!.version).toBe(3)
    expect(getTour('pipeline')!.version).toBe(2)
  })
})

describe('mobile and architecture stay unchanged', () => {
  it('does not show the empty message or acquire the lock on mobile', async () => {
    mount(`<div data-leads-empty></div>`)
    renderEducation(<Starter />, { surface: 'mobile' })
    fireEvent.click(screen.getByRole('button', { name: 'start-pipeline' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText('אין כרגע לידים')).toBeNull()
    expect(driverState.calls).toBe(0)
    expect(isTourLockHeld()).toBe(false)
    expect(readState(USER_ID).tours.pipeline).toBeUndefined()
  })

  it('does not add a TourId and checks empty before acquiring the Driver.js lock', () => {
    const runTourSrc = readFileSync('components/education/runTour.ts', 'utf8')
    const fn = runTourSrc.slice(runTourSrc.indexOf('export async function runTour'))
    const emptyAt = fn.indexOf('waitForLeadsWorkspaceEmpty')
    const lockAt = fn.indexOf('if (!acquireTourLock())')
    expect(emptyAt).toBeGreaterThan(-1)
    expect(lockAt).toBeGreaterThan(emptyAt)
    expect(readFileSync('lib/education/types.ts', 'utf8')).not.toMatch(/leadsEmpty|pipelineEmpty/)
    expect(readFileSync('lib/education/registry.ts', 'utf8')).not.toMatch(/id: 'leads-empty'/)
  })

  it('keeps Help → סיור בלידים on /leads as startTour pipeline', () => {
    const help = readFileSync('components/education/HelpMenu.tsx', 'utf8')
    // The button labels come from the catalog (Phase E6); in Hebrew they are the same words.
    const handler = help.split("lbl={t('education.help.pipeline')}")[1]?.split("lbl={t('education.help.guides')}")[0] ?? ''
    expect(handler).toContain("startTour('pipeline'")
    expect(handler).toContain("pathname.startsWith('/leads')")
  })
})
