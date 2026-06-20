// @vitest-environment jsdom

/**
 * Interaction safety (P0-1 single-flight + P0-2 freeze stale) at the PANEL level.
 *   A — stale chips cannot fire onPick
 *   B — stale lead-pick options cannot fire onPickLead
 *   C — while an action runs, a second submit / chip / pick starts nothing
 *   D — the latest turn stays fully interactive
 * No routing/analytics/loading behavior is asserted here — only interaction gating.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('@/lib/copilot/useCopilot', () => ({ useCopilot: () => ({ closePanel: vi.fn() }) }))
vi.mock('@/actions/analytics/recordGeneralModeEvent', () => ({ recordGeneralModeEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/actions/ai/getDailyBriefing', () => ({ getDailyBriefing: vi.fn() }))
vi.mock('@/actions/ai/askGeneralQuestion', () => ({ askGeneralQuestion: vi.fn(), getLeadCardById: vi.fn() }))
// Keep render light + free of timers/router (none of this is under test).
vi.mock('@/components/copilot/ActiveGenerationRow', () => ({ default: () => null }))
vi.mock('@/components/copilot/general/BriefingCards', () => ({ default: () => null }))
vi.mock('@/components/copilot/general/DeepLink', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

import GeneralModePanel from '@/components/copilot/general/GeneralModePanel'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion, getLeadCardById } from '@/actions/ai/askGeneralQuestion'

const REDIRECT = { kind: 'fallback', mode: 'redirect', gap: null }
const GUIDE = { kind: 'guide', answer: 'תשובת מדריך', route: '/x' }
const LEADPICK = {
  kind: 'leadPick',
  name: 'דוד',
  candidates: [
    { leadId: 1, label: 'דוד א', status: null },
    { leadId: 2, label: 'דוד ב', status: null },
  ],
}
const LEADCARD = {
  kind: 'lead',
  lead: {
    id: 1, name: 'דוד א', status: null, leadSource: null,
    daysSinceLastInteraction: null, daysInCurrentStatus: null,
    overdueTaskCount: 0, nextFollowUpAt: null, recentTasks: [],
  },
}

async function renderPanel() {
  render(<GeneralModePanel />)
  await screen.findByPlaceholderText('שאל את העוזר…')
}
async function submit(text: string) {
  const ta = screen.getByPlaceholderText('שאל את העוזר…')
  await act(async () => {
    fireEvent.change(ta, { target: { value: text } })
    fireEvent.keyDown(ta, { key: 'Enter' })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.HTMLElement.prototype.scrollTo = vi.fn() as never // jsdom has no layout engine
  vi.mocked(getDailyBriefing).mockResolvedValue({ kind: 'briefing', greeting: 'שלום', sections: [] } as never)
})

describe('A — stale chips', () => {
  it('clicking a chip from an older assistant turn fires nothing', async () => {
    vi.mocked(askGeneralQuestion).mockResolvedValueOnce(REDIRECT as never).mockResolvedValueOnce(GUIDE as never)
    await renderPanel()
    await submit('שאלה 1')
    expect(await screen.findByText('מה דורש תשומת לב')).toBeEnabled() // latest → interactive
    await submit('שאלה 2') // a newer turn arrives → the redirect is now stale
    await screen.findByText('תשובת מדריך')
    const staleChip = screen.getByText('מה דורש תשומת לב')
    expect(staleChip).toBeDisabled()
    fireEvent.click(staleChip)
    expect(askGeneralQuestion).toHaveBeenCalledTimes(2) // no third call
  })
})

describe('B — stale lead picks', () => {
  it('clicking an option from an older leadPick fires nothing', async () => {
    vi.mocked(askGeneralQuestion).mockResolvedValueOnce(LEADPICK as never).mockResolvedValueOnce(GUIDE as never)
    await renderPanel()
    await submit('מי זה דוד')
    await screen.findByText('דוד א')
    await submit('שאלה אחרת') // newer turn → leadPick now stale
    await screen.findByText('תשובת מדריך')
    const oldOption = screen.getByText('דוד א')
    expect(oldOption).toBeDisabled()
    fireEvent.click(oldOption)
    expect(getLeadCardById).not.toHaveBeenCalled()
  })
})

describe('C — concurrency (single active action)', () => {
  it('C1 — a second composer submit while busy starts nothing', async () => {
    let resolve1: (v: unknown) => void = () => {}
    vi.mocked(askGeneralQuestion).mockReturnValueOnce(new Promise((r) => (resolve1 = r)) as never)
    await renderPanel()
    await submit('ראשונה') // in flight
    await submit('שנייה') // ignored
    expect(askGeneralQuestion).toHaveBeenCalledTimes(1)
    await act(async () => resolve1(REDIRECT))
  })

  it('C2 — a second chip click while busy starts nothing', async () => {
    let resolve2: (v: unknown) => void = () => {}
    vi.mocked(askGeneralQuestion)
      .mockResolvedValueOnce(REDIRECT as never)
      .mockReturnValueOnce(new Promise((r) => (resolve2 = r)) as never)
    await renderPanel()
    await submit('ראשונה')
    const chipA = await screen.findByText('מה דורש תשומת לב')
    fireEvent.click(chipA) // 2nd action, in flight (still the latest turn)
    const chipB = screen.getByText('מי צריך מעקב היום')
    fireEvent.click(chipB) // ignored by the single-flight guard
    expect(askGeneralQuestion).toHaveBeenCalledTimes(2)
    await act(async () => resolve2(GUIDE))
  })

  it('C3 — a second lead pick while busy starts nothing', async () => {
    vi.mocked(askGeneralQuestion).mockResolvedValueOnce(LEADPICK as never)
    let resolvePick: (v: unknown) => void = () => {}
    vi.mocked(getLeadCardById).mockReturnValueOnce(new Promise((r) => (resolvePick = r)) as never)
    await renderPanel()
    await submit('מי זה דוד')
    const b1 = await screen.findByText('דוד א')
    const b2 = await screen.findByText('דוד ב')
    fireEvent.click(b1) // in flight
    fireEvent.click(b2) // ignored
    expect(getLeadCardById).toHaveBeenCalledTimes(1)
    await act(async () => resolvePick(LEADCARD))
  })
})

describe('D — latest turn still works', () => {
  it('newest chips remain interactive', async () => {
    vi.mocked(askGeneralQuestion).mockResolvedValue(REDIRECT as never)
    await renderPanel()
    await submit('ראשונה')
    const chip = await screen.findByText('מה דורש תשומת לב')
    expect(chip).toBeEnabled()
    fireEvent.click(chip)
    await waitFor(() => expect(askGeneralQuestion).toHaveBeenCalledTimes(2))
  })

  it('newest lead picks remain interactive', async () => {
    vi.mocked(askGeneralQuestion).mockResolvedValueOnce(LEADPICK as never)
    vi.mocked(getLeadCardById).mockResolvedValueOnce(LEADCARD as never)
    await renderPanel()
    await submit('מי זה דוד')
    const b1 = await screen.findByText('דוד א')
    expect(b1).toBeEnabled()
    fireEvent.click(b1)
    await waitFor(() => expect(getLeadCardById).toHaveBeenCalledTimes(1))
  })
})
