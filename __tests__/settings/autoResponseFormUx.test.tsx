// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/**
 * The מענה אוטומטי form's interaction layer: the save bar that exists only
 * while there is something to save, the unload warning, the one label pattern,
 * the counter, the "sent to the customer" badge, the tone chips, the FAQ empty
 * state, the advanced disclosure and the daily-cap helper.
 */

const h = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }))
vi.mock('@/actions/autoResponse/updateSettings', () => ({ updateAutoResponseSettings: h.save }))
vi.mock('@/actions/autoResponse/previewAgent', () => ({ previewAgentTurn: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: h.toast }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))
vi.mock('@/lib/Icon', () => ({ default: () => <span /> }))
vi.mock('@/lib/btns/Btn', () => ({
  Btn: ({ lbl, onClick, disabled }: { lbl: string; onClick?: () => void; disabled?: boolean }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {lbl}
    </button>
  ),
}))
vi.mock('@/lib/form', () => ({
  Switch: ({ checked, onChange, 'aria-label': ariaLabel }: { checked: boolean; onChange: (e: { target: { checked: boolean } }) => void; 'aria-label'?: string }) => (
    <input type='checkbox' aria-label={ariaLabel} checked={checked} onChange={(e) => onChange({ target: { checked: e.target.checked } })} />
  ),
}))

import AutoResponseSettingsForm from '@/components/settings/autoResponse/AutoResponseSettingsForm'
import { counterTone } from '@/components/settings/autoResponse/AutoResponseTextField'

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
  agentProfile: null,
  method: { stored: 'ai' as const, questionnaire: { available: true as const }, aiConversational: true, stalled: false },
}

const DIRTY = 'יש שינויים שלא נשמרו'
const bar = () => document.querySelector('[data-auto-response-save-bar]')
const description = () => screen.getByLabelText('ספרו לסוכן על העסק ומה תרצו שיעשה') as HTMLTextAreaElement

afterEach(() => {
  cleanup()
  h.save.mockReset()
  h.toast.mockReset()
})

describe('the save bar', () => {
  it('is not there until something changes, then says so with cancel and save', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(bar()).toBeNull()
    expect(screen.queryByRole('button', { name: 'שמור שינויים' })).toBeNull()

    fireEvent.change(description(), { target: { value: 'מוסך בחולון, פתוחים עד 17:00' } })
    expect(bar()).not.toBeNull()
    expect(within(bar() as HTMLElement).getByText(DIRTY)).toBeTruthy()
    expect(within(bar() as HTMLElement).getByRole('button', { name: 'ביטול' })).toBeTruthy()
    expect(within(bar() as HTMLElement).getByRole('button', { name: 'שמור שינויים' })).toBeTruthy()
  })

  it('cancel restores the saved values and the bar leaves', () => {
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.change(description(), { target: { value: 'משהו אחר' } })
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(description().value).toBe('מוסך בחולון')
    expect(bar()).toBeNull()
  })

  it('a successful save confirms by toast and the bar leaves', async () => {
    h.save.mockResolvedValue({ ok: true, profileDerived: true, unsupportedRequests: [] })
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.change(description(), { target: { value: 'מוסך בחולון, פתוחים עד 17:00' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמור שינויים' }))
    })
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][0]).toMatchObject({ guidance: 'מוסך בחולון, פתוחים עד 17:00' })
    expect(h.toast).toHaveBeenCalledWith('success', 'השינויים נשמרו')
    expect(bar()).toBeNull()
  })

  it('a refused save keeps the bar, with the error', async () => {
    h.save.mockResolvedValue({ ok: false, reason: 'unknown' })
    render(<AutoResponseSettingsForm {...props} />)
    fireEvent.change(description(), { target: { value: 'שינוי' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמור שינויים' }))
    })
    expect(within(bar() as HTMLElement).getByRole('alert').textContent).toBe('לא ניתן לשמור')
  })

  it('leaving the page with unsaved changes is warned; a settled page is not', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const settled = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(settled)
    expect(settled.defaultPrevented).toBe(false)

    fireEvent.change(description(), { target: { value: 'שינוי' } })
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
  })
})

describe('the top of the page', () => {
  it('the WhatsApp channel switch is hidden while it is on', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(screen.queryByText('הערוץ שבו נשלח המענה. ערוצים נוספים יתווספו בהמשך.')).toBeNull()
  })

  it('a stored OFF keeps the channel switch, so auto-reply can be turned back on', () => {
    render(<AutoResponseSettingsForm {...props} channelEnabled={false} />)
    expect(screen.getByText('הערוץ שבו נשלח המענה. ערוצים נוספים יתווספו בהמשך.')).toBeTruthy()
  })
})

describe('text fields', () => {
  it('label, then helper, then the box — the box described by the helper', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const box = description()
    const hint = document.getElementById(box.getAttribute('aria-describedby') as string)
    expect(hint?.textContent).toContain('כתבו מה העסק מציע')
    const label = document.querySelector(`label[for="${box.id}"]`) as HTMLElement
    // Document order: label → helper → textarea.
    expect(label.compareDocumentPosition(hint as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((hint as Node).compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the counter is isolated left-to-right and reads "length / limit"', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const counter = document.querySelector('bdi[dir="ltr"]') as HTMLElement
    expect(counter.textContent).toBe('11 / 1000')
  })

  it('the counter warns at 90% of the limit and errors at the limit', () => {
    expect(counterTone(899, 1000)).toBe('normal')
    expect(counterTone(900, 1000)).toBe('warning')
    expect(counterTone(999, 1000)).toBe('warning')
    expect(counterTone(1000, 1000)).toBe('error')
  })

  it('no field says it is NOT sent; the greeting carries the one "sent" badge', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(screen.queryByText('הטקסט הזה לא נשלח ללקוח')).toBeNull()
    const badges = document.querySelectorAll('[data-sent-badge]')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('נשלח ללקוח כלשונו')
    expect(badges[0].parentElement?.textContent).toContain('ברכת פתיחה')
  })

  it('the fixed message carries the badge too', () => {
    render(<AutoResponseSettingsForm {...props} replyMode='fixed' method={{ ...props.method, stored: 'fixed' }} />)
    const badges = document.querySelectorAll('[data-sent-badge]')
    expect(badges).toHaveLength(1)
    expect(badges[0].parentElement?.textContent).toContain('ההודעה שתישלח')
  })
})

describe('agent profile controls', () => {
  it('tone is one chip group; only the selected option explains itself', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const group = screen.getByRole('group', { name: 'טון מועדף בשיחות עסקיות' })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    expect(within(group).getByText('הסוכן מתאים את עצמו לאופן שבו הלקוח כותב')).toBeTruthy()
    expect(within(group).queryByText('קצר, ברור, בלי סלנג')).toBeNull()

    fireEvent.click(within(group).getByLabelText('מקצועי וענייני'))
    expect(within(group).getByText('קצר, ברור, בלי סלנג')).toBeTruthy()
    expect(within(group).queryByText('הסוכן מתאים את עצמו לאופן שבו הלקוח כותב')).toBeNull()
  })

  it('an empty FAQ shows one example, pre-fills nothing, and adds from a real button', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const empty = document.querySelector('[data-faq-empty]') as HTMLElement
    expect(empty.textContent).toContain('כמה זמן מראש צריך להזמין?')
    expect(screen.queryByLabelText('שאלה 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'הוספת שאלה נפוצה' }))
    expect((screen.getByLabelText('שאלה 1') as HTMLInputElement).value).toBe('')
    expect(document.querySelector('[data-faq-empty]')).toBeNull()
  })

  it('advanced settings are a real disclosure', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const toggle = screen.getByRole('button', { name: 'הגדרות מתקדמות' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('הנחיות נוספות לסוכן')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-controls') as string)?.hidden).toBe(false)
    expect(screen.getByLabelText('הנחיות נוספות לסוכן')).toBeTruthy()
  })

  it('the personal-conversation sentence moved into a tooltip with an accessible name', () => {
    render(<AutoResponseSettingsForm {...props} />)
    expect(screen.getByText('לא חובה. מה שתכתבו כאן הסוכן מכיר בכל שיחה, בנוסף לתיאור העסק.', { exact: false })).toBeTruthy()
    const trigger = screen.getByText('בשיחה אישית עם חבר הוא לא משתמש בברכה ובטון העסקי.').parentElement as HTMLElement
    expect(trigger.getAttribute('tabindex')).toBe('0')
  })
})

describe('daily cap', () => {
  it('says what happens when the cap is reached', () => {
    render(<AutoResponseSettingsForm {...props} />)
    const cap = screen.getByLabelText('מקסימום מענים ביום')
    expect(document.getElementById(cap.getAttribute('aria-describedby') as string)?.textContent).toContain(
      'כשמגיעים לתקרה, הודעות חדשות לא מקבלות מענה אוטומטי עד היום הבא ומחכות לטיפול שלכם.',
    )
  })
})
