// @vitest-environment jsdom

/**
 * ARCHITECTURAL RULE under test:
 *
 *   `hasAnyLeads` (surfaced as `briefing.kind === 'empty'`) decides the CONTENT
 *   rendered inside the AI panel. It must NEVER decide whether the panel is
 *   available or interactive.
 *
 * Regression origin: production user #351 / agency #120 opened the assistant three
 * times and asked zero questions, because the zero-lead branch rendered a static
 * card and unmounted the composer — there was no input on screen — and both of its
 * CTAs deep-linked to `/leads` without opening any flow.
 *
 * The panel has THREE distinct states that must never collapse into each other:
 *   locked / expired  → SubscriptionExpiredState (entitlement)
 *   zero leads        → zero-data state + working create/import + composer
 *   leads exist       → briefing + suggestions + composer
 *
 * The entitlement half of this suite is a GUARD, not new behaviour: it pins the
 * production expired-subscription semantics so the availability change cannot
 * silently re-open a paid AI surface to a lapsed account.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const H = vi.hoisted(() => ({ expired: false }))

vi.mock('@/lib/copilot/useCopilot', () => ({ useCopilot: () => ({ closePanel: vi.fn() }) }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => H.expired }))
vi.mock('@/components/entitlement/SubscriptionExpiredState', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`expired-${mode}`} />,
}))
vi.mock('@/actions/analytics/recordGeneralModeEvent', () => ({ recordGeneralModeEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/actions/ai/getDailyBriefing', () => ({ getDailyBriefing: vi.fn() }))
vi.mock('@/actions/ai/askGeneralQuestion', () => ({ askGeneralQuestion: vi.fn(), getLeadCardById: vi.fn() }))
vi.mock('@/components/copilot/ActiveGenerationRow', () => ({ default: () => null }))
vi.mock('@/components/copilot/general/BriefingCards', () => ({ default: () => <div data-testid='briefing-cards' /> }))

// The real create/import flows are stubbed at their module boundary: these tests
// assert the WIRING (an existing flow is invoked — not a fake button, not a dead
// link). The forms' own behaviour has its own suites and needs a UserProvider + DB.
vi.mock('@/components/clients/ClientFormPop', () => ({
  default: ({ onCreated }: { onCreated?: (id: number) => void }) => (
    <div data-testid='client-form-pop'>
      <button type='button' onClick={() => onCreated?.(7)}>
        stub-save
      </button>
    </div>
  ),
}))
vi.mock('@/components/settings/UploadClientData', () => ({ default: () => <div data-testid='upload-client-data' /> }))

import GeneralModePanel from '@/components/copilot/general/GeneralModePanel'
import { getDailyBriefing } from '@/actions/ai/getDailyBriefing'
import { askGeneralQuestion } from '@/actions/ai/askGeneralQuestion'
import type { BriefingResult } from '@/lib/copilot/general/types'

const EMPTY: BriefingResult = { kind: 'empty' }
const LOCKED: BriefingResult = { kind: 'locked' }
const WITH_LEADS: BriefingResult = { kind: 'briefing', greeting: 'היום: 2 מעקבים.', sections: [] }
const COMPOSER = 'שאל את העוזר…'

beforeEach(() => {
  vi.clearAllMocks()
  H.expired = false
  window.HTMLElement.prototype.scrollTo = vi.fn() as never // jsdom has no layout engine
})

describe('AI panel availability is NOT gated by hasAnyLeads', () => {
  it('keeps the composer mounted and usable with zero leads', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    render(<GeneralModePanel />)

    const composer = await screen.findByPlaceholderText(COMPOSER)
    expect(composer).toBeInTheDocument()
    expect(composer).not.toBeDisabled()
  })

  it('renders the purposeful zero-data state, not a blank panel', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    render(<GeneralModePanel />)

    expect(await screen.findByText('עדיין אין לך לידים')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'צור ליד' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ייבא לידים' })).toBeInTheDocument()
  })

  it('answers a question asked with zero leads instead of swallowing it', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    vi.mocked(askGeneralQuestion).mockResolvedValue({ kind: 'guide', answer: 'תשובה' })
    render(<GeneralModePanel />)

    const ta = await screen.findByPlaceholderText(COMPOSER)
    await act(async () => {
      fireEvent.change(ta, { target: { value: 'מה אפשר לעשות' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })

    await waitFor(() => expect(screen.getByText('תשובה')).toBeInTheDocument())
    // The zero-data state yields to the conversation once a turn exists.
    expect(screen.queryByText('עדיין אין לך לידים')).not.toBeInTheDocument()
  })
})

describe('zero-data actions invoke the REAL existing flows', () => {
  it('"צור ליד" opens the existing lead-creation flow', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    render(<GeneralModePanel />)

    await screen.findByRole('button', { name: 'צור ליד' })
    expect(screen.queryByTestId('client-form-pop')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'צור ליד' }))
    })

    expect(await screen.findByTestId('client-form-pop')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('"ייבא לידים" opens the existing import flow', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    render(<GeneralModePanel />)

    await screen.findByRole('button', { name: 'ייבא לידים' })
    expect(screen.queryByTestId('upload-client-data')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ייבא לידים' }))
    })

    expect(await screen.findByTestId('upload-client-data')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('creating a lead re-reads the briefing and stays inside the panel', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(WITH_LEADS)
    render(<GeneralModePanel />)

    await screen.findByRole('button', { name: 'צור ליד' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'צור ליד' }))
    })
    await act(async () => {
      fireEvent.click(await screen.findByText('stub-save'))
    })

    await waitFor(() => expect(screen.getByTestId('briefing-cards')).toBeInTheDocument())
    expect(screen.queryByText('עדיין אין לך לידים')).not.toBeInTheDocument()
    expect(getDailyBriefing).toHaveBeenCalledTimes(2)
    expect(screen.getByPlaceholderText(COMPOSER)).toBeInTheDocument()
  })
})

describe('users WITH leads keep the existing experience exactly', () => {
  it('renders briefing + quick-question chips + composer, and no zero-data state', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(WITH_LEADS)
    render(<GeneralModePanel />)

    expect(await screen.findByTestId('briefing-cards')).toBeInTheDocument()
    expect(screen.getByText('שאלות מהירות')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(COMPOSER)).toBeInTheDocument()
    expect(screen.queryByText('עדיין אין לך לידים')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'צור ליד' })).not.toBeInTheDocument()
  })
})

describe('ENTITLEMENT GUARD — production expired behaviour is unchanged', () => {
  it('server-locked shows the panel expired state and NO composer', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(LOCKED)
    render(<GeneralModePanel />)

    expect(await screen.findByTestId('expired-panel')).toBeInTheDocument()
    // The availability change must not re-open the composer for a locked account.
    expect(screen.queryByPlaceholderText(COMPOSER)).not.toBeInTheDocument()
    expect(screen.queryByText('עדיין אין לך לידים')).not.toBeInTheDocument()
  })

  it('server-locked never renders a second, inline copy of the expired state', async () => {
    vi.mocked(getDailyBriefing).mockResolvedValue(LOCKED)
    render(<GeneralModePanel />)

    await screen.findByTestId('expired-panel')
    expect(screen.queryByTestId('expired-inline')).not.toBeInTheDocument()
  })

  it('expired context with zero leads swaps the composer for the inline expired state', async () => {
    H.expired = true
    vi.mocked(getDailyBriefing).mockResolvedValue(EMPTY)
    render(<GeneralModePanel />)

    // Zero-data content still renders (creating a lead is a CRM action, not a paid
    // AI request) but the paid composer is replaced, exactly as on the leads path.
    expect(await screen.findByTestId('expired-inline')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(COMPOSER)).not.toBeInTheDocument()
  })

  it('expired context with leads keeps chips disabled and the composer replaced', async () => {
    H.expired = true
    vi.mocked(getDailyBriefing).mockResolvedValue(WITH_LEADS)
    render(<GeneralModePanel />)

    expect(await screen.findByTestId('expired-inline')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(COMPOSER)).not.toBeInTheDocument()
    const chips = screen.getAllByRole('button').filter((b) => b.textContent && b.textContent.length > 2)
    expect(chips.length).toBeGreaterThan(0)
    chips.forEach((b) => expect(b).toBeDisabled())
  })
})
