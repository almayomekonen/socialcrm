// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ action: vi.fn(), toast: vi.fn(), denied: false }))
vi.mock('@/actions/autoResponse/setResponder', () => ({ setAutoResponseResponder: h.action }))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))
vi.mock('@/lib/Icon', () => ({ default: () => <span /> }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => h.denied }))

import ResponderSelector from '@/components/settings/autoResponse/ResponderSelector'
import { resolveResponderChoice, type ResponderChoiceInput } from '@/lib/inbox/autoresponse/responderChoice'

const choice = (over: Partial<ResponderChoiceInput> = {}) =>
  resolveResponderChoice({ responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaireAllowed: true, questionnairePublished: true, ...over })
const card = (name: RegExp) => screen.getByRole('button', { name })
const AGENT = /סוכן AI חכם/
const QUESTIONNAIRE = /שאלון מובנה/

afterEach(() => {
  cleanup()
  h.action.mockReset()
  h.toast.mockReset()
  h.denied = false
})

describe('which card is selected comes from the persisted responder', () => {
  it('agent stored → agent pressed, questionnaire not', () => {
    render(<ResponderSelector choice={choice()} />)
    expect(card(AGENT).getAttribute('aria-pressed')).toBe('true')
    expect(card(QUESTIONNAIRE).getAttribute('aria-pressed')).toBe('false')
    // The active card's "פעיל" badge says it; the "פעיל כעת" line would only repeat it.
    expect(card(AGENT).textContent).toContain('פעיל')
    expect(screen.queryByText(/פעיל כעת/)).toBeNull()
  })

  it('the questionnaire option links to its editor even while it is not the active method', () => {
    render(<ResponderSelector choice={choice()} builderHref='/settings/questionnaire' />)
    expect(screen.getByRole('link', { name: 'עריכת השאלון' }).getAttribute('href')).toBe('/settings/questionnaire')
  })

  it('questionnaire stored → questionnaire pressed, with an edit link to the Builder', () => {
    render(<ResponderSelector choice={choice({ responder: 'questionnaire' })} builderHref='/settings/questionnaire' />)
    expect(card(QUESTIONNAIRE).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('link', { name: 'עריכת השאלון' }).getAttribute('href')).toBe('/settings/questionnaire')
  })
})

describe('unavailable options', () => {
  it('a one-reply agency: the AI agent is not a button, explains why, and nothing is selected', () => {
    render(<ResponderSelector choice={choice({ mode: 'acknowledge', replyMode: 'fixed' })} />)
    expect(screen.queryByRole('button', { name: AGENT })).toBeNull()
    expect(screen.getByText(/סוכן ה-AI עם שיחה מלאה עדיין לא זמין לעסק שלכם/)).toBeTruthy()
    expect(screen.queryByRole('button', { pressed: true })).toBeNull()
    // No card is active here, so the line stays: it is the only explanation of what customers get.
    expect(screen.getByRole('status').textContent).toContain('הודעה קבועה אחת')
  })

  it('no published questionnaire: unavailable, with a link to build one', () => {
    render(<ResponderSelector choice={choice({ questionnairePublished: false })} builderHref='/settings/questionnaire' />)
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.getByText(/עדיין אין שאלון מפורסם/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'לבניית השאלון' }).getAttribute('href')).toBe('/settings/questionnaire')
  })
})

describe('confirmation before anything is saved', () => {
  it('clicking the active card does nothing', () => {
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(card(AGENT))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.action).not.toHaveBeenCalled()
  })

  it('cancel closes the dialog and saves nothing', async () => {
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(card(QUESTIONNAIRE))
    expect(screen.getByText(/להפעיל את השאלון המובנה\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    await waitFor(() => expect(screen.queryByText(/להפעיל את השאלון המובנה\?/)).toBeNull())
    expect(h.action).not.toHaveBeenCalled()
  })

  it('confirm sends the stored value as `from` and reports success', async () => {
    h.action.mockResolvedValue({ ok: true, responder: 'questionnaire' })
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(card(QUESTIONNAIRE))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'הפעל שאלון' })))
    expect(h.action).toHaveBeenCalledWith({ to: 'questionnaire', from: 'agent' })
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('success', 'השאלון המובנה פעיל'))
  })

  it('questionnaire → agent: the dialog names the method and the consequence', () => {
    render(<ResponderSelector choice={choice({ responder: 'questionnaire' })} />)
    fireEvent.click(card(AGENT))
    expect(screen.getByText(/להפעיל את סוכן ה-AI החכם\?/).textContent).toContain('כל פנייה חדשה בוואטסאפ')
    expect(screen.getByRole('button', { name: 'הפעל סוכן AI' })).toBeTruthy()
  })

  it.each([
    ['conflict', 'שיטת המענה שונתה בינתיים'],
    ['unavailable', 'לא ניתן להפעיל את השיטה הזו כרגע'],
    ['forbidden', 'לא הצלחנו לשנות את שיטת המענה'],
  ])('a refused switch (%s) shows the error and no success', async (reason, text) => {
    h.action.mockResolvedValue({ ok: false, reason })
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(card(QUESTIONNAIRE))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'הפעל שאלון' })))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(text))
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('a double click on confirm sends one request', async () => {
    let resolve!: (v: unknown) => void
    h.action.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(card(QUESTIONNAIRE))
    const confirm = screen.getByRole('button', { name: 'הפעל שאלון' })
    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(h.action).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ ok: true, responder: 'questionnaire' }))
  })
})

describe('no settings row yet', () => {
  it('both cards unavailable, the state and the first step are explained, nothing is clickable', () => {
    render(<ResponderSelector choice={null} />)
    expect(screen.queryByRole('button', { name: AGENT })).toBeNull()
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('המענה האוטומטי עוד לא הוגדר לעסק')
    expect(screen.getByRole('status').textContent).toContain('שמור שינויים')
    expect(h.action).not.toHaveBeenCalled()
  })

  it('on a phone, says the first setup is done from a computer', () => {
    render(<ResponderSelector choice={null} readOnly />)
    expect(screen.getByRole('status').textContent).toContain('ההגדרה הראשונה נעשית מהמחשב')
  })
})

describe('read-only surfaces', () => {
  it('phone view and an expired plan: the other card cannot be clicked', () => {
    render(<ResponderSelector choice={choice()} readOnly />)
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.getByText('שינוי שיטת המענה נעשה מהמחשב.')).toBeTruthy()
    cleanup()
    h.denied = true
    render(<ResponderSelector choice={choice()} />)
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
  })
})
