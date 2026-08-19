// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { emptyState, readState, recordTour, writeState } from '@/lib/education/storage'
import { getTour } from '@/lib/education/registry'
import { acquireTourLock, __resetTourLockForTests } from '@/lib/education/tourLock'
import {
  ActivationCelebrationProvider,
  useActivationCelebration,
} from '@/components/trial/ActivationCelebrationContext'

let tourQuery: string | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => ({
    get: (key: string) => (key === 'tour' ? tourQuery : null),
  }),
}))

vi.mock('@/actions/education/recordEducationEvent', () => ({
  recordEducationEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/components/education/runTour', () => ({
  runTour: vi.fn(async () => ({ status: 'completed', lastStep: 12 })),
  stopActiveTour: vi.fn(),
  runOverviewIntro: vi.fn(),
}))

import EducationMount from '@/components/education/EducationMount'
import { EducationProvider, useEducation } from '@/components/education/EducationProvider'
import AutoTour from '@/components/education/AutoTour'
import ProductTourHost from '@/components/education/ProductTourHost'
import HelpMenu from '@/components/education/HelpMenu'
import HelpTrigger from '@/components/education/HelpTrigger'
import ProActivationSuccess from '@/components/trial/ProActivationSuccess'
import { runOverviewIntro, runTour, stopActiveTour } from '@/components/education/runTour'
import type { OverviewIntroOutcome } from '@/components/education/runTour'

const USER_ID = 91
const overview = getTour('overview')!
const mockedRunTour = vi.mocked(runTour)
const mockedIntro = vi.mocked(runOverviewIntro)
const mockedStop = vi.mocked(stopActiveTour)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let introDeferred = deferred<OverviewIntroOutcome | null>()

function seedEligible() {
  writeState(USER_ID, {
    tours: {},
    overviewIntro: { version: 1, status: 'eligible', at: '2026-08-19T00:00:00.000Z' },
  })
}

function renderWorkspace(children?: ReactNode, opts?: { copilotEnabled?: boolean }) {
  return render(
    <EducationProvider
      userId={USER_ID}
      surface='desktop'
      copilotEnabled={opts?.copilotEnabled ?? true}
      toursEnabled
    >
      {children}
      <HelpTrigger />
      <ProductTourHost />
    </EducationProvider>,
  )
}

function JustActivatedWorkspace() {
  const { justActivated, markActivated } = useActivationCelebration()
  const [workspaceReady, setWorkspaceReady] = useState(false)
  useEffect(() => {
    markActivated()
  }, [markActivated])
  useEffect(() => {
    if (justActivated) setWorkspaceReady(true)
  }, [justActivated])
  if (!workspaceReady) return null
  return (
    <EducationProvider userId={USER_ID} surface='desktop' copilotEnabled toursEnabled>
      <ProActivationSuccess />
      <HelpTrigger />
      <ProductTourHost />
    </EducationProvider>
  )
}

function FreshUserActivationShell() {
  const { markActivated } = useActivationCelebration()
  const [toursEnabled, setToursEnabled] = useState(false)

  return (
    <EducationMount userId={USER_ID} surface='desktop' copilotEnabled toursEnabled={toursEnabled}>
      {toursEnabled ? (
        <>
          <ProActivationSuccess />
          <HelpTrigger />
        </>
      ) : (
        <button
          type='button'
          onClick={() => {
            markActivated()
            setToursEnabled(true)
          }}
        >
          start-trial
        </button>
      )}
    </EducationMount>
  )
}

function HelpAlreadyOpenShell() {
  const { helpOpen, openHelp } = useEducation()
  useEffect(() => {
    openHelp()
  }, [openHelp])
  if (!helpOpen) return null
  return (
    <>
      <HelpTrigger />
      <ProductTourHost />
    </>
  )
}

beforeEach(() => {
  introDeferred = deferred<OverviewIntroOutcome | null>()
  mockedIntro.mockImplementation(() => introDeferred.promise)
  mockedRunTour.mockResolvedValue({ status: 'completed', lastStep: 12 })
  __resetTourLockForTests()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  mockedRunTour.mockReset()
  mockedRunTour.mockResolvedValue({ status: 'completed', lastStep: 12 })
  mockedIntro.mockReset()
  introDeferred = deferred<OverviewIntroOutcome | null>()
  mockedIntro.mockImplementation(() => introDeferred.promise)
  mockedStop.mockReset()
  tourQuery = null
  __resetTourLockForTests()
})

async function expectNoInvitation() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  expect(mockedIntro).not.toHaveBeenCalled()
}

describe('first-time Help spotlight invitation', () => {
  it('spotlights Help for a newly eligible desktop user', async () => {
    seedEligible()
    renderWorkspace()
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'עזרה' })).toBeTruthy()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('does not invite an existing user merely because education storage is empty', async () => {
    expect(readState(USER_ID)).toEqual(emptyState())
    renderWorkspace()
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    fireEvent.click(await screen.findByRole('button', { name: 'הראה לי איך המערכת עובדת' }))
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'overview', version: overview.version })
  })

  it('does not invite while the trial is NEVER_STARTED', async () => {
    seedEligible()
    render(
      <EducationMount userId={USER_ID} surface='desktop' copilotEnabled toursEnabled={false}>
        <HelpTrigger />
      </EducationMount>,
    )
    await expectNoInvitation()
    expect(screen.queryByRole('button', { name: 'עזרה' })).toBeNull()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('does not mount the invitation or Driver.js on mobile', async () => {
    seedEligible()
    render(
      <EducationMount userId={USER_ID} surface='mobile' copilotEnabled toursEnabled={false}>
        <AutoTour id='overview' enabled />
        <HelpTrigger />
      </EducationMount>,
    )
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('does not show the invitation again after it has been declined', async () => {
    writeState(USER_ID, {
      tours: {},
      overviewIntro: { version: 1, status: 'declined', at: '2026-08-01T00:00:00.000Z' },
    })
    renderWorkspace()
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('does not stack on the Pro activation celebration, then invites after dismiss', async () => {
    render(
      <ActivationCelebrationProvider>
        <JustActivatedWorkspace />
      </ActivationCelebrationProvider>,
    )
    expect(await screen.findByText('ה־Pro שלך פעיל')).toBeTruthy()
    expect(mockedIntro).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(mockedRunTour).not.toHaveBeenCalled()
    await waitFor(() => expect(readState(USER_ID).overviewIntro?.status).toBe('eligible'))

    fireEvent.click(screen.getByRole('button', { name: 'התחל לעבוד עם Pro' }))
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('shows the invitation after Pro dismiss without remounting EducationMount', async () => {
    render(
      <ActivationCelebrationProvider>
        <FreshUserActivationShell />
      </ActivationCelebrationProvider>,
    )
    expect(mockedIntro).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'start-trial' }))

    expect(await screen.findByText('ה־Pro שלך פעיל')).toBeTruthy()
    expect(mockedIntro).not.toHaveBeenCalled()
    await waitFor(() => expect(readState(USER_ID).overviewIntro?.status).toBe('eligible'))

    fireEvent.click(screen.getByRole('button', { name: 'התחל לעבוד עם Pro' }))
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('launches the existing overview tour on accept and does not re-invite after refresh', async () => {
    seedEligible()
    const { unmount } = renderWorkspace()
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    await act(async () => {
      introDeferred.resolve('accepted')
      await introDeferred.promise
    })
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'overview', version: overview.version })
    expect(readState(USER_ID).overviewIntro?.status).toBe('accepted')

    unmount()
    mockedIntro.mockClear()
    introDeferred = deferred<OverviewIntroOutcome | null>()
    mockedIntro.mockImplementation(() => introDeferred.promise)
    renderWorkspace()
    await expectNoInvitation()
    expect(mockedRunTour).toHaveBeenCalledTimes(1)
  })

  it('does not launch the tour on decline and does not auto re-invite', async () => {
    seedEligible()
    const { unmount } = renderWorkspace()
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    await act(async () => {
      introDeferred.resolve('declined')
      await introDeferred.promise
    })
    await waitFor(() => expect(readState(USER_ID).overviewIntro?.status).toBe('declined'))
    expect(mockedRunTour).not.toHaveBeenCalled()

    unmount()
    mockedIntro.mockClear()
    introDeferred = deferred<OverviewIntroOutcome | null>()
    mockedIntro.mockImplementation(() => introDeferred.promise)
    renderWorkspace()
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('still launches the same overview tour from Help after decline', async () => {
    seedEligible()
    renderWorkspace()
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    await act(async () => {
      introDeferred.resolve('declined')
      await introDeferred.promise
    })
    await waitFor(() => expect(readState(USER_ID).overviewIntro?.status).toBe('declined'))
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    fireEvent.click(await screen.findByRole('button', { name: 'הראה לי איך המערכת עובדת' }))
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'overview', version: overview.version })
  })

  it('never auto-invites after the overview tour has completed', async () => {
    writeState(USER_ID, recordTour(emptyState(), 'overview', overview.version, 'completed'))
    renderWorkspace()
    await expectNoInvitation()
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    fireEvent.click(await screen.findByRole('button', { name: 'הראה לי איך המערכת עובדת' }))
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'overview' })
  })

  it('does not re-invite if the user accepts and then dismisses the tour halfway', async () => {
    mockedRunTour.mockResolvedValue({ status: 'dismissed', lastStep: 2 })
    seedEligible()
    const { unmount } = renderWorkspace()
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    await act(async () => {
      introDeferred.resolve('accepted')
      await introDeferred.promise
    })
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(readState(USER_ID).tours.overview?.status).toBe('dismissed'))
    expect(readState(USER_ID).overviewIntro?.status).toBe('accepted')

    unmount()
    mockedIntro.mockClear()
    introDeferred = deferred<OverviewIntroOutcome | null>()
    mockedIntro.mockImplementation(() => introDeferred.promise)
    renderWorkspace()
    await expectNoInvitation()
    fireEvent.click(screen.getByRole('button', { name: 'עזרה' }))
    expect(await screen.findByRole('button', { name: 'הראה לי איך המערכת עובדת' })).toBeTruthy()
  })

  it('keeps AutoTour from starting while the invitation is in flight', async () => {
    seedEligible()
    renderWorkspace(<AutoTour id='pipeline' enabled />, { copilotEnabled: false })
    await waitFor(() => expect(mockedIntro).toHaveBeenCalledTimes(1))
    expect(mockedRunTour).not.toHaveBeenCalled()
    await act(async () => {
      introDeferred.resolve('declined')
      await introDeferred.promise
    })
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'pipeline' })
  })

  it('does not offer while a ?tour= launch is in flight', async () => {
    tourQuery = 'overview'
    renderWorkspace()
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalled())
    expect(mockedIntro).not.toHaveBeenCalled()
    expect(mockedRunTour.mock.calls.every((call) => call[0]?.id === 'overview')).toBe(true)
    expect(readState(USER_ID).overviewIntro).toBeUndefined()
  })

  it('does not show the automatic invitation when Help is already open', async () => {
    seedEligible()
    render(
      <EducationProvider userId={USER_ID} surface='desktop' copilotEnabled toursEnabled>
        <HelpAlreadyOpenShell />
      </EducationProvider>,
    )
    expect(await screen.findByRole('button', { name: 'הראה לי איך המערכת עובדת' })).toBeTruthy()
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
  })

  it('does not steal the lock from an active tour', async () => {
    seedEligible()
    expect(acquireTourLock()).toBe(true)
    renderWorkspace()
    await expectNoInvitation()
    expect(mockedRunTour).not.toHaveBeenCalled()
    expect(mockedStop).not.toHaveBeenCalled()
  })
})

describe('HelpMenu', () => {
  it('still starts the existing overview tour from Help when the invitation is not showing', async () => {
    writeState(USER_ID, {
      tours: {},
      overviewIntro: { version: 1, status: 'declined', at: '2026-08-01T00:00:00.000Z' },
    })
    render(
      <EducationProvider userId={USER_ID} surface='desktop' copilotEnabled toursEnabled>
        <HelpMenu onClose={() => {}} />
      </EducationProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'הראה לי איך המערכת עובדת' }))
    await waitFor(() => expect(mockedRunTour).toHaveBeenCalledTimes(1))
    expect(mockedRunTour.mock.calls[0]?.[0]).toMatchObject({ id: 'overview', version: overview.version })
  })
})

describe('invitation architecture', () => {
  it('does not add a second tour id or change the overview sequence', () => {
    expect(overview.auto).toBe(false)
    expect(overview.steps.map((step) => step.title)).toEqual([
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
    ])
    expect(overview.steps.some((step) => step.element === '[data-edu="help-trigger"]')).toBe(false)
  })

  it('does not render a workspace welcome card', () => {
    seedEligible()
    renderWorkspace()
    expect(screen.queryByText('ברוכים הבאים ל־SocialCRM')).toBeNull()
    expect(screen.queryByText('רוצה סיור קצר במערכת?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'התחל סיור' })).toBeNull()
  })
})
