// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import AgentPreview from '@/components/settings/autoResponse/AgentPreview'

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

/**
 * The preview panel actually mounts and works. The settings route is behind
 * auth, so a browser check needs a session — this exercises the component
 * directly, which is what the a11y suite cannot reach while the panel is closed
 * by default.
 */
describe('AgentPreview', () => {
  it('starts closed, behind one clear button', () => {
    render(<AgentPreview {...props} />)
    expect((screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByLabelText('הודעה כלקוח')).toBeNull()
  })

  it('is disabled, with a reason, until the owner has described the business', () => {
    render(<AgentPreview {...props} draftDescription='' savedDescription='' />)
    expect((screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('כתבו קודם על העסק כדי לבדוק את הסוכן.')).toBeTruthy()
  })

  it('opens into an empty conversation that names the business', () => {
    render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(screen.getByLabelText('הודעה כלקוח')).toBeTruthy()
    expect(screen.getByText(/מוסך אלון/)).toBeTruthy()
  })

  it('states that nothing is sent anywhere', () => {
    render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(
      screen.getByText('זו סימולציה. לא נשלחת הודעה בוואטסאפ, לא נוצר ליד, ואף אחד מהצוות לא מקבל התראה.'),
    ).toBeTruthy()
  })

  it('says whether it is testing saved settings or unsaved text', () => {
    const { unmount } = render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(screen.getByText('נבדק לפי ההגדרות השמורות.')).toBeTruthy()
    unmount()

    render(<AgentPreview {...props} draftDescription='טקסט חדש שעדיין לא נשמר' />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect(screen.getByText('נבדק לפי הטקסט שכתבתם עכשיו ועדיין לא שמרתם.')).toBeTruthy()
  })

  it('sends a customer message and shows the agent reply', async () => {
    render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))

    fireEvent.change(screen.getByLabelText('הודעה כלקוח'), { target: { value: 'האוטו עושה רעש בבלמים' } })
    fireEvent.click(screen.getByRole('button', { name: 'שליחה' }))

    expect(await screen.findByText('האוטו עושה רעש בבלמים')).toBeTruthy()
    expect(await screen.findByText(/ברוך הבא למוסך אלון/)).toBeTruthy()
  })

  it('clears the conversation on "שיחה חדשה"', async () => {
    render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    fireEvent.change(screen.getByLabelText('הודעה כלקוח'), { target: { value: 'שלום' } })
    fireEvent.click(screen.getByRole('button', { name: 'שליחה' }))
    expect(await screen.findByText('שלום')).toBeTruthy()
    // Wait for the agent's reply, so the reset clears a settled conversation
    // rather than racing the in-flight turn.
    expect(await screen.findByText(/ברוך הבא למוסך אלון/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'שיחה חדשה' }))
    expect(screen.queryByText('שלום')).toBeNull()
    expect(screen.getByText(/כתבו הודעה כמו שלקוח היה כותב/)).toBeTruthy()
  })

  it('the send control is disabled until there is something to send', () => {
    render(<AgentPreview {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'בדקו את הסוכן שלכם' }))
    expect((screen.getByRole('button', { name: 'שליחה' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('הודעה כלקוח'), { target: { value: 'שלום' } })
    expect((screen.getByRole('button', { name: 'שליחה' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
