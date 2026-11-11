// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/Icon', () => ({ default: () => <span /> }))

import ResponderSelector from '@/components/settings/autoResponse/ResponderSelector'
import { resolveResponderChoice, type ResponderChoiceInput } from '@/lib/inbox/autoresponse/responderChoice'

/**
 * The phone's read-only "which method answers" block. Switching lives on the
 * desktop form only (ResponseMethodSelector); the old instant-switch action was
 * removed, so nothing here can write anything.
 */

const choice = (over: Partial<ResponderChoiceInput> = {}) =>
  resolveResponderChoice({ responder: 'agent', mode: 'qualify', replyMode: 'ai', questionnaireAllowed: true, questionnairePublished: true, ...over })
const AGENT = /סוכן AI חכם/
const QUESTIONNAIRE = /שאלון מובנה/

afterEach(() => cleanup())

describe('the persisted method, shown read-only', () => {
  it('agent stored → agent card selected with its badge; the other card is inert', () => {
    render(<ResponderSelector choice={choice()} />)
    const agent = screen.getByRole('button', { name: AGENT })
    expect(agent.getAttribute('aria-pressed')).toBe('true')
    expect(agent.textContent).toContain('פעיל')
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.queryByText(/פעיל כעת/)).toBeNull()
    expect(screen.getByText('שינוי שיטת המענה נעשה מהמחשב.')).toBeTruthy()
  })

  it('questionnaire stored → questionnaire card selected', () => {
    render(<ResponderSelector choice={choice({ responder: 'questionnaire' })} />)
    expect(screen.getByRole('button', { name: QUESTIONNAIRE }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: AGENT })).toBeNull()
  })

  it('clicking the selected card opens nothing and changes nothing', () => {
    render(<ResponderSelector choice={choice()} />)
    fireEvent.click(screen.getByRole('button', { name: AGENT }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: AGENT }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('states without an active card', () => {
  it('a one-reply agency: nothing selected, the reason, and the line naming what customers get', () => {
    render(<ResponderSelector choice={choice({ mode: 'acknowledge', replyMode: 'fixed' })} />)
    expect(screen.queryByRole('button', { pressed: true })).toBeNull()
    expect(screen.getByText(/סוכן ה-AI עם שיחה מלאה עדיין לא זמין לעסק שלכם/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('הודעה קבועה אחת')
  })

  it('no published questionnaire: unavailable, with the reason', () => {
    render(<ResponderSelector choice={choice({ questionnairePublished: false })} />)
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.getByText(/עדיין אין שאלון מפורסם/)).toBeTruthy()
  })

  it('a stalled questionnaire says so', () => {
    render(<ResponderSelector choice={choice({ responder: 'questionnaire', questionnairePublished: false })} />)
    expect(screen.getByText(/השאלון לא יכול לענות כרגע/)).toBeTruthy()
  })

  it('no settings row: both cards unavailable, and the first setup is done from a computer', () => {
    render(<ResponderSelector choice={null} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('המענה האוטומטי עוד לא הוגדר לעסק. ההגדרה הראשונה נעשית מהמחשב.')
  })
})
