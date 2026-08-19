// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ShowMeButton from '@/components/education/ShowMeButton'
import { acquireTourLock, __resetTourLockForTests } from '@/lib/education/tourLock'

const push = vi.fn()
const requestEducationAction = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/dashboard',
}))

vi.mock('@/actions/education/recordEducationEvent', () => ({
  recordEducationEvent: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/education', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/education')>()
  return {
    ...actual,
    requestEducationAction: (...args: unknown[]) => requestEducationAction(...args),
  }
})

beforeEach(() => {
  push.mockReset()
  requestEducationAction.mockReset()
  __resetTourLockForTests()
})

describe('ShowMeButton', () => {
  it('does not render an unknown action', () => {
    const { container } = render(<ShowMeButton action='open_anything' />)
    expect(container).toBeEmptyDOMElement()
  })

  it('launches the existing pipeline tour path from Copilot', () => {
    render(<ShowMeButton action='open_pipeline_tour' />)
    fireEvent.click(screen.getByRole('button', { name: /הראה לי/ }))
    expect(push).toHaveBeenCalledWith('/leads?tour=pipeline&from=copilot')
    expect(requestEducationAction).not.toHaveBeenCalled()
  })

  it('does nothing while another tour is running', () => {
    acquireTourLock()
    render(<ShowMeButton action='open_pipeline_tour' />)
    fireEvent.click(screen.getByRole('button', { name: /הראה לי/ }))
    expect(push).not.toHaveBeenCalled()
    expect(requestEducationAction).not.toHaveBeenCalled()
  })

  it('requests the education layer in place when no navigation is needed', () => {
    render(<ShowMeButton action='open_copilot_tour' />)
    fireEvent.click(screen.getByRole('button', { name: /הראה לי/ }))
    expect(requestEducationAction).toHaveBeenCalledWith('open_copilot_tour')
    expect(push).not.toHaveBeenCalled()
  })

  it('launches the overview tour in place and never changes route', () => {
    render(<ShowMeButton action='open_overview_tour' />)
    fireEvent.click(screen.getByRole('button', { name: /הראה לי/ }))
    expect(requestEducationAction).toHaveBeenCalledWith('open_overview_tour')
    expect(push).not.toHaveBeenCalled()
  })

  it('is keyboard accessible and disabled for stale Copilot turns', () => {
    render(<ShowMeButton action='open_copilot_tour' disabled />)
    const btn = screen.getByRole('button', { name: /הראה לי/ })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(requestEducationAction).not.toHaveBeenCalled()
  })
})
