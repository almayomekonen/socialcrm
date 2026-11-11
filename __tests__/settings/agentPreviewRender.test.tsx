// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AgentPreviewLauncher, AgentPreviewPanel, useAgentPreview } from '@/components/settings/autoResponse/AgentPreview'

vi.mock('@/actions/autoResponse/previewAgent', () => ({
  previewAgentTurn: vi.fn(async () => ({
    ok: true as const,
    reply: 'היי, ברוך הבא למוסך אלון 👋 בלמים זה משהו שאנחנו מטפלים בו. איזה רכב?',
    usedDraft: false,
    profileDerived: true,
    trace: { greeted: true, language: 'he' as const, salesMove: 'DISCOVERY', control: 'CONTINUE', validator: 'ok' as const, simulated: null },
  })),
}))

const props = {
  draftDescription: 'מוסך בחולון, טיפולים ותיקונים.',
  draftAgentInstructions: '',
  savedDescription: 'מוסך בחולון, טיפולים ותיקונים.',
  businessName: 'מוסך אלון',
}

/** The form's wiring: one conversation state, the panel beside the form and the narrow-screen launcher. */
function Harness(p: typeof props) {
  const preview = useAgentPreview(p)
  return (
    <>
      <AgentPreviewLauncher preview={preview} />
      <AgentPreviewPanel preview={preview} />
    </>
  )
}

const panel = () => screen.getByRole('complementary', { name: 'בדיקת הסוכן' })

/**
 * The test chat actually mounts and works. The settings route is behind auth,
 * so a browser check needs a session — this exercises the components directly.
 * jsdom applies no media queries, so both the wide-screen panel and the
 * narrow-screen launcher are in the DOM here; which one shows is CSS (`lg:`).
 */
describe('AgentPreview — the side panel', () => {
  it('is open from the start, as a chat that names the business', () => {
    render(<Harness {...props} />)
    expect(within(panel()).getByLabelText('הודעה כלקוח')).toBeTruthy()
    expect(within(panel()).getAllByText(/מוסך אלון/).length).toBeGreaterThan(0)
  })

  it('cannot be used, with a reason, until the owner has described the business', () => {
    render(<Harness {...props} draftDescription='' savedDescription='' />)
    expect((within(panel()).getByLabelText('הודעה כלקוח') as HTMLInputElement).disabled).toBe(true)
    expect(within(panel()).getByText('כתבו קודם על העסק כדי לבדוק את הסוכן.')).toBeTruthy()
  })

  it('states that nothing is sent anywhere', () => {
    render(<Harness {...props} />)
    expect(within(panel()).getByText('זו סימולציה. לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה.')).toBeTruthy()
  })

  it('says whether it is testing saved settings or unsaved text', () => {
    const { unmount } = render(<Harness {...props} />)
    expect(within(panel()).getByText('נבדק לפי ההגדרות השמורות.')).toBeTruthy()
    unmount()

    render(<Harness {...props} draftDescription='טקסט חדש שעדיין לא נשמר' />)
    expect(within(panel()).getByText('נבדק לפי הטקסט שכתבתם עכשיו ועדיין לא שמרתם.')).toBeTruthy()
  })

  it('sends a customer message and shows the agent reply', async () => {
    render(<Harness {...props} />)
    fireEvent.change(within(panel()).getByLabelText('הודעה כלקוח'), { target: { value: 'האוטו עושה רעש בבלמים' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'שליחה' }))

    expect(await within(panel()).findByText('האוטו עושה רעש בבלמים')).toBeTruthy()
    expect(await within(panel()).findByText(/ברוך הבא למוסך אלון/)).toBeTruthy()
  })

  it('clears the conversation on "שיחה חדשה"', async () => {
    render(<Harness {...props} />)
    fireEvent.change(within(panel()).getByLabelText('הודעה כלקוח'), { target: { value: 'שלום' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'שליחה' }))
    expect(await within(panel()).findByText('שלום')).toBeTruthy()
    // Wait for the agent's reply, so the reset clears a settled conversation
    // rather than racing the in-flight turn.
    expect(await within(panel()).findByText(/ברוך הבא למוסך אלון/)).toBeTruthy()

    fireEvent.click(within(panel()).getByRole('button', { name: 'שיחה חדשה' }))
    expect(within(panel()).queryByText('שלום')).toBeNull()
    expect(within(panel()).getByText(/כתבו הודעה כמו שלקוח היה כותב/)).toBeTruthy()
  })

  it('the send control is disabled until there is something to send', () => {
    render(<Harness {...props} />)
    expect((within(panel()).getByRole('button', { name: 'שליחה' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(panel()).getByLabelText('הודעה כלקוח'), { target: { value: 'שלום' } })
    expect((within(panel()).getByRole('button', { name: 'שליחה' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('AgentPreview — narrow screens', () => {
  it('one button opens the same chat in a dialog', () => {
    render(<Harness {...props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('הודעה כלקוח')).toBeTruthy()
  })

  it('the button is disabled, with a reason, until the owner has described the business', () => {
    render(<Harness {...props} draftDescription='' savedDescription='' />)
    expect((screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the panel and the dialog show one conversation', async () => {
    render(<Harness {...props} />)
    fireEvent.change(within(panel()).getByLabelText('הודעה כלקוח'), { target: { value: 'שלום מהפאנל' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'שליחה' }))
    expect(await within(panel()).findByText(/ברוך הבא למוסך אלון/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(within(screen.getByRole('dialog')).getByText('שלום מהפאנל')).toBeTruthy()
  })
})
