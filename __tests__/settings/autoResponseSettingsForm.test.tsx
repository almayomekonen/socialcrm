// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ save: vi.fn(), denied: false }))
vi.mock('@/actions/autoResponse/updateSettings', () => ({ updateAutoResponseSettings: h.save }))
vi.mock('@/actions/autoResponse/previewAgent', () => ({ previewAgentTurn: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => h.denied }))
vi.mock('@/lib/btns/Btn', () => ({
  Btn: ({ lbl, onClick, disabled }: { lbl: string; onClick?: () => void; disabled?: boolean }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {lbl}
    </button>
  ),
}))
vi.mock('@/lib/Icon', () => ({
  default: () => <span />,
}))
vi.mock('@/lib/form', () => ({
  Switch: ({
    checked,
    onChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean
    onChange: (e: { target: { checked: boolean } }) => void
    'aria-label'?: string
  }) => (
    <input
      type='checkbox'
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange({ target: { checked: e.target.checked } })}
    />
  ),
}))

import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'
import type { MethodProps } from '@/components/settings/autoResponse/autoResponseDraft'

const method = (over: Partial<MethodProps> = {}): MethodProps => ({
  stored: 'ai',
  questionnaire: { available: true },
  aiConversational: true,
  stalled: false,
  builderHref: '/settings/questionnaire',
  ...over,
})

const props = {
  masterEnabled: true,
  channelEnabled: true,
  dailyCap: 200,
  guidance: 'מוסך בחולון' as string | null,
  agentInstructions: null as string | null,
  businessName: 'מוסך אלון',
  replyMode: 'ai' as 'ai' | 'fixed',
  fixedBody: 'שלום, נחזור אליך' as string | null,
  delaySeconds: 0,
  method: method(),
}

const AI = /סוכן AI חכם/
const QUESTIONNAIRE = /שאלון מובנה/
const FIXED = /^הודעה קבועה/
const card = (name: RegExp) => screen.getByRole('button', { name })
const DESCRIPTION = 'ספרו לסוכן על העסק ומה תרצו שיעשה'

afterEach(() => {
  cleanup()
  h.save.mockReset()
  h.denied = false
})

describe('AutoResponseSettingsForm delay field', () => {
  it('shows the stored delaySeconds value, not a hardcoded 0', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={5} />)
    const input = screen.getByLabelText('המתנה לפני שליחה') as HTMLInputElement
    expect(input.value).toBe('5')
  })

  it('shows 0 when the stored delay is 0', () => {
    render(<AutoResponseSettingsForm {...props} delaySeconds={0} />)
    const input = screen.getByLabelText('המתנה לפני שליחה') as HTMLInputElement
    expect(input.value).toBe('0')
  })
})

describe('one choice of three response methods', () => {
  it('shows the three methods; the stored one is marked active and selected', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(card(AI).getAttribute('aria-pressed')).toBe('true')
    expect(card(AI).textContent).toContain('פעיל')
    expect(card(QUESTIONNAIRE).getAttribute('aria-pressed')).toBe('false')
    expect(card(FIXED).getAttribute('aria-pressed')).toBe('false')
    // The old second choice ("מענה חכם / הודעה קבועה") is gone.
    expect(screen.queryByRole('radio', { name: /מענה חכם/ })).toBeNull()
    expect(screen.queryByText('סגנון התשובה')).toBeNull()
  })

  it('shows only the selected method’s settings', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(screen.getByLabelText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByLabelText('ההודעה שתישלח')).toBeNull()

    fireEvent.click(card(FIXED))
    expect(card(FIXED).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('ההודעה שתישלח')).toBeTruthy()
    expect(screen.queryByLabelText(DESCRIPTION)).toBeNull()
    // The test chat belongs to the AI only.
    expect(screen.queryByRole('complementary', { name: 'בדיקת הסוכן' })).toBeNull()
  })

  it('picking a method saves nothing by itself; it is part of the form', () => {
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.click(card(FIXED))
    expect(h.save).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('יש שינויים שלא נשמרו')).toBeTruthy()
    // The active badge stays on what answers customers until the save.
    expect(card(AI).textContent).toContain('פעיל')
  })

  it('the save bar sends the chosen method and the one the page showed as stored', async () => {
    h.save.mockResolvedValue({ ok: true, profileDerived: true, unsupportedRequests: [] })
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.click(card(FIXED))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמור שינויים' }))
    })
    expect(h.save.mock.calls[0][0]).toMatchObject({ method: 'fixed', methodFrom: 'ai', replyMode: 'fixed', fixedBody: 'שלום, נחזור אליך' })
    // Saved: the badge moves to the new method.
    expect(card(FIXED).textContent).toContain('פעיל')
  })

  it('a stale page is refused with the existing "refresh" message', async () => {
    h.save.mockResolvedValue({ ok: false, reason: 'method_conflict' })
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.click(card(QUESTIONNAIRE))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמור שינויים' }))
    })
    expect(screen.getByRole('alert').textContent).toBe('שיטת המענה שונתה בינתיים. רעננו את העמוד ונסו שוב.')
  })
})

describe('the questionnaire', () => {
  it('stored: the agent settings are hidden, kept, and the Builder is one link away', () => {
    render(<AutoResponseSettingsForm {...props} method={method({ stored: 'questionnaire' })} />)
    expect(card(QUESTIONNAIRE).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('הגדרות הסוכן מוסתרות כי השאלון פעיל. הן נשמרות כמו שהן.')).toBeTruthy()
    expect(screen.queryByLabelText(DESCRIPTION)).toBeNull()
    expect(screen.getByRole('link', { name: 'עריכת השאלון' }).getAttribute('href')).toBe('/settings/questionnaire')
  })

  it('switching away warns inline, under the selector, about conversations in progress', () => {
    render(<AutoResponseSettingsForm {...props} method={method({ stored: 'questionnaire' })} />)
    expect(document.querySelector('[data-switch-note]')).toBeNull()
    fireEvent.click(card(FIXED))
    const note = document.querySelector('[data-switch-note="leave-questionnaire"]') as HTMLElement
    expect(note.textContent).toContain('מי שנמצא באמצע השאלון יקבל בהודעה הבאה שלו את הודעת ההעברה שלכם')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('switching to it says what happens to conversations already started', () => {
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.click(card(QUESTIONNAIRE))
    expect((document.querySelector('[data-switch-note="to-questionnaire"]') as HTMLElement).textContent).toBe(
      'שיחות שכבר התחילו לא יקבלו מענה אוטומטי. הגדרות הסוכן נשמרות.',
    )
  })

  it('without a published copy it cannot be picked, and says how to build one', () => {
    render(<AutoResponseSettingsForm {...props} method={method({ questionnaire: { available: false, reason: 'questionnaire_not_published' } })} />)
    expect(screen.queryByRole('button', { name: QUESTIONNAIRE })).toBeNull()
    expect(screen.getByText(/עדיין אין שאלון מפורסם/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'לבניית השאלון' })).toBeTruthy()
  })
})

describe('one AI reply (outside the conversational rollout)', () => {
  it('is never labelled as the AI agent; it says what it does', () => {
    render(<AutoResponseSettingsForm {...props} method={method({ aiConversational: false })} />)
    expect(screen.queryByText(AI)).toBeNull()
    const ai = card(/תשובת AI אחת/)
    expect(ai.textContent).toContain('בלי שיחה מתמשכת')
    expect(ai.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('סוכן ה-AI עם שיחה מלאה עדיין לא זמין לעסק שלכם.')).toBeTruthy()
  })
})

describe('an expired plan', () => {
  it('the page stays readable; other methods cannot be picked', () => {
    h.denied = true
    render(<AutoResponseSettingsForm {...props} />)
    expect(card(AI).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: FIXED })).toBeNull()
  })
})
