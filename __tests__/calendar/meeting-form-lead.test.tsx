// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'

/**
 * THE MEETING FORM MUST BE ABLE TO NAME A LEAD.
 *
 * The production defect this closes: `MeetingFormDialog` took `leadId` as a PROP
 * and `CalendarView` never passed one, so every meeting created from /calendar
 * had `lead_id = NULL`. `emitAppointmentBooked` returns early without a lead, so
 * `appointment_booked` was never emitted and no reminder could ever be queued.
 * Production evidence: 4 of 4 meetings on agency 103 had no lead, and zero
 * `appointment%` jobs had ever been created.
 *
 * Two things are asserted here, and the second matters as much as the first:
 * the picker persists the lead through the EXISTING `leadId` field, and a
 * meeting with no lead SAYS SO before it is created rather than failing silently.
 */

const createMeeting = vi.fn(async () => ({ ok: true as const, meetingId: 7, meetUrl: null, syncStatus: 'synced' as const }))
const searchLeads = vi.fn(async () => [
  { id: 1353, details: 'Almayo Mekonen', firstName: 'Almayo', lastName: 'Mekonen', idNum: null },
  { id: 1400, details: 'Dana Levi', firstName: 'Dana', lastName: 'Levi', idNum: null },
])
const getLeadById = vi.fn(async (id: number) => ({ id, firstName: 'Almayo', lastName: 'Mekonen', idNum: null }))

vi.mock('@/actions/calendar', () => ({ createMeeting }))
vi.mock('@/actions/clients', () => ({ searchLeads, getLeadById }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const { default: MeetingFormDialog } = await import('@/components/calendar/MeetingFormDialog')

const future = (hoursAhead: number) => {
  const d = new Date()
  d.setHours(d.getHours() + hoursAhead, 0, 0, 0)
  return d
}

const open = () =>
  render(
    <MeetingFormDialog open onClose={() => {}} defaultStart={future(24)} defaultEnd={future(25)} />,
  )

beforeEach(() => {
  cleanup()
  createMeeting.mockClear()
  searchLeads.mockClear()
  getLeadById.mockClear()
})

/** The house convention is fireEvent (see connectionsPage.test.tsx). */
const fill = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } })
const submitButton = () => screen.getByRole('button', { name: /שמור|צור|קבע/ })

describe('the form exposes a lead picker', () => {
  it('renders the picker, using the existing shared component', async () => {
    open()
    // The shared LeadPicker's own trigger copy — proof it is the reused
    // component and not a second picker built for this dialog.
    expect(await screen.findByRole('button', { name: /בחר לקוח/ })).toBeInTheDocument()
  })

  it('prefills the options from the existing agency-scoped reader', async () => {
    open()
    await waitFor(() => expect(searchLeads).toHaveBeenCalledWith(''))
  })

  it('seeds from the leadId prop when opened from a lead context', async () => {
    render(<MeetingFormDialog open onClose={() => {}} leadId={1353} defaultStart={future(24)} defaultEnd={future(25)} />)
    await waitFor(() => expect(getLeadById).toHaveBeenCalledWith(1353))
    // Named in the trigger, so the user can see which lead it is for.
    expect(await screen.findByRole('button', { name: /Almayo Mekonen/ })).toBeInTheDocument()
  })
})

describe('the no-lead state is explicit, not silent', () => {
  it('warns that appointment automations will not run', async () => {
    open()
    expect(
      await screen.findByText(/לא נבחר ליד — אוטומציות פגישה .* לא יפעלו/),
      'a meeting with no lead must say that reminders will not run',
    ).toBeInTheDocument()
  })

  it('drops the warning once a lead is chosen', async () => {
    render(<MeetingFormDialog open onClose={() => {}} leadId={1353} defaultStart={future(24)} defaultEnd={future(25)} />)
    await waitFor(() => expect(getLeadById).toHaveBeenCalled())
    expect(screen.queryByText(/לא נבחר ליד/)).not.toBeInTheDocument()
  })

  it('still allows the meeting — a lead-less meeting is valid, just automation-less', async () => {
    open()
    fill(screen.getByLabelText('כותרת'), 'בדיקה')
    fireEvent.click(submitButton())
    await waitFor(() => expect(createMeeting).toHaveBeenCalled())
    expect((createMeeting.mock.calls[0] as unknown as [{ leadId: number | null }])[0].leadId).toBeNull()
  })
})

describe('the picker opens ABOVE the dialog', () => {
  /**
   * The bug: the panel carried `z-50` while ModalPop is `z-99999`. Both portal to
   * `document.body`, so they are siblings and z-order alone decides — the
   * dropdown opened behind the dialog it was launched from.
   *
   * 100000 is the app's existing portal-popover layer (OutcomeControl,
   * LeadQuickActions), not a number invented here.
   */
  /**
   * Read from ModalPop rather than hardcoded, so the invariant is anchored to the
   * real modal: if the dialog layer is ever raised, this test fails instead of
   * silently passing while the dropdown sinks behind it again.
   */
  const MODAL_Z = (() => {
    const src = readFileSync('lib/modals/ModalPop.tsx', 'utf8')
    const m = /z-(\d{3,})/.exec(src)
    if (!m) throw new Error('ModalPop no longer declares a numeric z-index class')
    return Number(m[1])
  })()

  it('is anchored to the real modal layer', () => {
    expect(MODAL_Z).toBe(99999)
  })

  it('renders the panel above the modal layer', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /בחר לקוח/ }))

    const panel = await screen.findByPlaceholderText('חיפוש לקוח/ה...')
    const floating = panel.closest('div[style*="z-index"]') as HTMLElement | null
    expect(floating, 'the panel is not in a positioned floating container').not.toBeNull()

    const z = Number(floating!.style.zIndex)
    expect(z).toBeGreaterThan(MODAL_Z)
    expect(z).toBe(100000)
    // Fixed to the viewport, so a scrollable dialog body cannot clip it.
    expect(floating!.style.position).toBe('fixed')
  })

  it('carries no stale low z-index class', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /בחר לקוח/ }))
    const panel = await screen.findByPlaceholderText('חיפוש לקוח/ה...')
    const floating = panel.closest('div[style*="z-index"]') as HTMLElement
    expect(floating.className).not.toMatch(/\bz-\d+\b/)
  })

  it('is portaled out of the dialog, so the dialog is unchanged', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /בחר לקוח/ }))
    const panel = await screen.findByPlaceholderText('חיפוש לקוח/ה...')
    // Not nested inside the dialog element — it is a body-level sibling.
    expect(panel.closest('[role="dialog"]')).toBeNull()
  })
})

describe('the lead is persisted through the existing field, and never guessed', () => {
  it('sends the picked lead as leadId', async () => {
    render(<MeetingFormDialog open onClose={() => {}} leadId={1353} defaultStart={future(24)} defaultEnd={future(25)} />)
    fill(screen.getByLabelText('כותרת'), 'פגישת היכרות')
    await waitFor(() => expect(getLeadById).toHaveBeenCalled())
    fireEvent.click(submitButton())

    await waitFor(() => expect(createMeeting).toHaveBeenCalled())
    const args = (createMeeting.mock.calls[0] as unknown as [{ leadId: number | null }])[0]
    // The SAME field the action already accepted — no new parameter, no new
    // shape, so the appointment_booked flow works with no engine change.
    expect(args.leadId).toBe(1353)
  })

  it('never derives a lead from an attendee address', async () => {
    open()
    fill(screen.getByLabelText('כותרת'), 'בדיקה')
    // An attendee whose email belongs to a real lead (1353 in production).
    const attendees = screen.getByPlaceholderText(/הוסף אימייל/)
    fill(attendees, 'alamayo274@gmail.com')
    fireEvent.keyDown(attendees, { key: 'Enter', code: 'Enter' })
    fireEvent.click(submitButton())

    await waitFor(() => expect(createMeeting).toHaveBeenCalled())
    const args = (createMeeting.mock.calls[0] as unknown as [{ leadId: number | null; attendees: unknown[] }])[0]
    // The address is carried as an attendee and NOTHING else. Matching it to a
    // lead is the identity-guessing this domain deliberately refuses.
    expect(args.leadId).toBeNull()
    expect(args.attendees).toEqual([{ email: 'alamayo274@gmail.com' }])
  })
})
