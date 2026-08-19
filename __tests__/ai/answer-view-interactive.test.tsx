// @vitest-environment jsdom

/**
 * P0-2 — stale (non-latest) assistant turns must be visual-only:
 * old chips disabled, old disambiguation buttons disabled, neither can execute.
 */

import { vi, describe, it, expect } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import AnswerView from '@/components/copilot/general/AnswerView'
import type { GeneralAnswer } from '@/actions/ai/askGeneralQuestion'

// Keep render pure — these aren't used by the fallback/leadPick branches under test.
vi.mock('@/components/copilot/general/DeepLink', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))
vi.mock('@/components/copilot/general/LeadRows', () => ({ default: () => null }))
vi.mock('@/components/copilot/bodies/DriveResultsBody', () => ({ DriveResultsBody: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/leads',
}))
vi.mock('@/actions/education/recordEducationEvent', () => ({
  recordEducationEvent: vi.fn(() => Promise.resolve()),
}))

const redirect: GeneralAnswer = { kind: 'fallback', mode: 'redirect', gap: null }
const leadPick: GeneralAnswer = {
  kind: 'leadPick',
  name: 'דוד',
  candidates: [
    { leadId: 1, label: 'דוד א', status: null },
    { leadId: 2, label: 'דוד ב', status: null },
  ],
}

describe('AnswerView — stale turns are non-interactive (P0-2)', () => {
  it('stale redirect chips are disabled and cannot execute', () => {
    const onPick = vi.fn()
    render(<AnswerView interactive={false} answer={redirect} onPick={onPick} onPickLead={vi.fn()} />)
    const chips = screen.getAllByRole('button')
    expect(chips.length).toBeGreaterThan(0)
    chips.forEach((b) => expect(b).toBeDisabled())
    fireEvent.click(chips[0])
    expect(onPick).not.toHaveBeenCalled()
  })

  it('stale disambiguation picks are disabled and cannot execute', () => {
    const onPickLead = vi.fn()
    render(<AnswerView interactive={false} answer={leadPick} onPick={vi.fn()} onPickLead={onPickLead} />)
    const btns = screen.getAllByRole('button')
    expect(btns.length).toBe(2)
    btns.forEach((b) => expect(b).toBeDisabled())
    fireEvent.click(btns[0])
    expect(onPickLead).not.toHaveBeenCalled()
  })

  it('the latest (interactive) turn still executes', () => {
    const onPick = vi.fn()
    render(<AnswerView interactive answer={redirect} onPick={onPick} onPickLead={vi.fn()} />)
    const chip = screen.getAllByRole('button')[0]
    expect(chip).not.toBeDisabled()
    fireEvent.click(chip)
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('offers a Show me action for a guided how-to and disables it on stale turns', () => {
    const guide: GeneralAnswer = {
      kind: 'guide',
      answer: 'Your pipeline is on Leads.\n\nI can walk you through it.',
      route: '/leads',
      educationAction: 'open_pipeline_tour',
    }
    const { rerender } = render(<AnswerView interactive answer={guide} onPick={vi.fn()} onPickLead={vi.fn()} />)
    const showMe = screen.getByRole('button', { name: /show me/i })
    expect(showMe).not.toBeDisabled()
    rerender(<AnswerView interactive={false} answer={guide} onPick={vi.fn()} onPickLead={vi.fn()} />)
    expect(screen.getByRole('button', { name: /show me/i })).toBeDisabled()
  })
})
