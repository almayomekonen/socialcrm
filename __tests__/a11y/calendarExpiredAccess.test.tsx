// @vitest-environment jsdom
//
// Calendar after a subscription lapses.
//
// READ is the customer's own history and stays open: /calendar renders, the
// meetings are there, and a meeting opens and reads normally. CREATE, EDIT,
// RESCHEDULE and CANCEL are the paid boundary, and each answers with the
// existing gold Pro prompt rather than the segment error boundary.
//
// No DB: runs in the no-DB suite.

import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'
import MeetingDetailsDialog from '@/components/calendar/MeetingDetailsDialog'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/** The Hebrew catalog holding the calendar page / Pro-prompt copy (Phase E1). */
const CALENDAR_PAGE_COPY = 'lib/i18n/messages/he/calendar/page.ts'

/** CalendarView and the hooks that hold its grid gestures and details-dialog actions (split in Phase E1). */
const CALENDAR_VIEW_FILES = [
  'components/calendar/CalendarView.tsx',
  'components/calendar/hooks/useMeetingReschedule.ts',
  'components/calendar/hooks/useMeetingSyncActions.ts',
]

const EXPIRED = { hasAccess: false, status: 'TRIAL_EXPIRED', expiresAt: '2026-08-20T20:03:27.824Z' }
const ACTIVE = { hasAccess: true, status: 'PAID', expiresAt: '2026-12-01T00:00:00.000Z' }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}))

const MEETING = {
  id: 42,
  title: 'פגישה עם דוד כהן',
  startAt: '2026-08-25T09:00:00.000Z',
  endAt: '2026-08-25T10:00:00.000Z',
  status: 'scheduled',
  syncStatus: 'synced',
  leadId: 7,
  meetUrl: null,
  syncError: null,
  completedAt: null,
  noShowAt: null,
}

function renderDetails(entitlement: typeof EXPIRED) {
  const noop = () => {}
  return render(
    <EntitlementProvider value={entitlement}>
      <MeetingDetailsDialog
        meeting={MEETING as never}
        onClose={noop}
        onCancel={async () => {}}
        onRetry={async () => {}}
        onEdit={noop}
        retrying={false}
        cancelling={false}
      />
    </EntitlementProvider>,
  )
}

afterEach(cleanup)

describe('the page renders for an expired customer', () => {
  /**
   * The defect: the page required only an authenticated agency user, but read
   * its meetings through a Pro-gated action, so the render threw
   * ProductAccessError and app/(he)/(app)/error.tsx answered "חלה שגיאה במערכת".
   */
  it('the meetings read no longer demands a subscription', () => {
    const src = read('actions/calendar/list.ts')
    expect(src).toContain('requireBasicCrmAccess()')
    expect(src).not.toContain('requireProductAccess')
  })

  it('the read is still authenticated and tenant scoped', () => {
    const src = read('actions/calendar/list.ts')
    expect(src).toContain('agencyId: user.agencyId')
    expect(src).toContain('organizerUserId: user.id')
  })

  it('the page itself never gained a gate, and never redirects', () => {
    const page = read('app/(he)/(app)/calendar/page.tsx')
    expect(page).toContain('requireAgencyUser()')
    expect(page).not.toContain('getAgencyProductAccess')
    expect(page).not.toContain('SubscriptionExpiredState')
    expect(page).not.toMatch(/redirect\('\/settings\/update_payment'\)/)
  })

  it('mobile keeps its own routing, unchanged by this policy', () => {
    const page = read('app/(he)/(app)/calendar/page.tsx')
    expect(page).toContain('isMobileWorkspaceRequest')
    expect(page).toContain('MobileDesktopOnly')
  })
})

describe('existing meetings are shown as real records, not locked ones', () => {
  it('the meeting reads normally', () => {
    renderDetails(EXPIRED)
    expect(screen.getByText('פגישה עם דוד כהן')).toBeTruthy()
    expect(screen.getByText('זמן')).toBeTruthy()
  })

  it('a scheduled meeting still looks scheduled', () => {
    renderDetails(EXPIRED)
    expect(screen.getByRole('button', { name: 'ערוך פגישה' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ביטול הפגישה/ })).toBeTruthy()
  })

  it('no locked state replaces the record', () => {
    const { container } = renderDetails(EXPIRED)
    expect(container.querySelector('[data-testid="subscription-expired-inline"]')).toBeNull()
    expect(container.querySelector('[data-testid="subscription-expired-state"]')).toBeNull()
  })

  it('the lead link is still followable', () => {
    renderDetails(EXPIRED)
    expect(screen.getByRole('link', { name: /צפה בליד/ }).getAttribute('href')).toBe('/clients/7/summary')
  })

  it('an active subscription renders identically', () => {
    renderDetails(ACTIVE)
    expect(screen.getByText('פגישה עם דוד כהן')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ערוך פגישה' })).toBeTruthy()
  })
})

describe('every write answers with the Pro prompt, never the error boundary', () => {
  // The view and the two hooks its handlers moved into (architecture-rules §1, Phase E1 split).
  const view = () => CALENDAR_VIEW_FILES.map(read).join('\n')

  it.each([
    ['create from the button', 'openNewMeeting'],
    ['create by selecting a range', 'handleSelect'],
    ['create by clicking a date', 'handleDateClick'],
  ])('%s prompts instead of opening the form', (_l, fn) => {
    const src = view()
    const at = src.indexOf(`function ${fn}(`)
    expect(at, fn).toBeGreaterThan(-1)
    expect(src.slice(at, at + 260), fn).toContain('if (expired) return promptCreate()')
  })

  it.each([
    ['drag to another time', 'handleEventDrop'],
    ['resize the duration', 'handleEventResize'],
  ])('%s reverts the gesture and prompts, sending nothing', (_l, fn) => {
    const src = view()
    const at = src.indexOf(`async function ${fn}(`)
    const body = src.slice(at, at + 320)
    expect(body, fn).toMatch(/if \(expired\) \{\s*\n\s*arg\.revert\(\)\s*\n\s*return promptMove\(\)/)
  })

  it.each([
    ['cancel', 'handleCancel', "t('calendar.pro.cancel.title')", 'ביטול פגישות זמין עם Pro'],
    ['retry the calendar sync', 'handleRetry', "t('calendar.pro.retry.title')", 'סנכרון יומן זמין עם Pro'],
  ])('%s prompts before the action runs', (_l, fn, title, hebrew) => {
    const src = view()
    const at = src.indexOf(`async function ${fn}(`)
    const body = src.slice(at, at + 420)
    expect(body, fn).toContain('if (expired) {')
    // The title is a catalog key since Phase E1; its Hebrew is the same sentence.
    expect(body, fn).toContain(title)
    expect(read(CALENDAR_PAGE_COPY), fn).toContain(`title: '${hebrew}'`)
  })

  it('edit and outcome prompt from the details dialog', () => {
    const src = read('components/calendar/MeetingDetailsDialog.tsx')
    expect(src).toContain('onClick={expired ? promptEdit : onEdit}')
    expect(src).toContain('expired ? promptOutcome() : outcome.markCompleted(meeting.id)')
    expect(src).toContain('expired ? promptOutcome() : outcome.markNoShow(meeting.id)')
  })

  it('reuses the existing Pro toast, and builds no second one', () => {
    const src = view()
    expect(src).toContain("from '@/lib/toast'")
    expect(src).toContain('proToast({ title, body, source })')
    // The toast itself is untouched and still owns the billing destination.
    expect(read('lib/toast.tsx')).toContain('href={upgradeHref(pop.pro.source)}')
  })

  it('the calendar stays interactive, so the boundary is reached deliberately', () => {
    const src = view()
    expect(src).toContain('selectable={true}')
    expect(src).toContain('editable={true}')
    expect(src).toContain("<Btn lbl={t('calendar.page.newMeeting')} onClick={() => openNewMeeting()} />")
  })
})

describe('server-side protection is untouched', () => {
  it.each([
    ['create', 'actions/calendar/create.ts'],
    ['update and reschedule', 'actions/calendar/update.ts'],
    ['cancel', 'actions/calendar/cancel.ts'],
    ['outcome', 'actions/calendar/outcome.ts'],
    ['sync retry', 'actions/calendar/retry.ts'],
  ])('%s still requires product access', (_l, file) => {
    expect(read(file)).toContain('requireProductAccess')
  })

  /** A bypassed client guard changes nothing: the action still refuses. */
  it('only the read moved, and it is the sole basic guard in the module', () => {
    const files = fs.readdirSync(path.join(process.cwd(), 'actions/calendar'))
    const basic = files.filter((f) => read(`actions/calendar/${f}`).includes('requireBasicCrmAccess'))
    expect(basic).toEqual(['list.ts'])
  })

  it('the edit form loader stays paid, because it serves the edit flow', () => {
    const src = read('actions/calendar/update.ts')
    const at = src.indexOf('export async function getMeetingForEdit(')
    expect(src.slice(at, at + 320)).toContain('requireProductAccess()')
  })
})

describe('the new calendar copy follows the Hebrew rule', () => {
  it('uses no dash or maqaf as a separator', () => {
    for (const line of [
      'יצירת פגישות זמינה עם Pro',
      'חידוש המנוי יחזיר את האפשרות לקבוע פגישות.',
      'עריכת פגישות זמינה עם Pro',
      'חידוש המנוי יחזיר את האפשרות לערוך פגישות.',
      'ביטול פגישות זמין עם Pro',
      'חידוש המנוי יחזיר את האפשרות לבטל פגישות.',
      'סנכרון יומן זמין עם Pro',
      'חידוש המנוי יחזיר את הסנכרון ליומן Google.',
      'עדכון תוצאת פגישה זמין עם Pro',
      'חידוש המנוי יחזיר את האפשרות לעדכן תוצאות.',
    ]) {
      expect(line, line).not.toMatch(/[-–—־]/)
    }
  })
})

describe('Calendar carries no standing subscription banner', () => {
  // The view and the two hooks its handlers moved into (architecture-rules §1, Phase E1 split).
  const view = () => CALENDAR_VIEW_FILES.map(read).join('\n')

  it('renders no persistent expired notice at all', () => {
    const src = view()
    expect(src).not.toContain('SubscriptionExpiredState')
    expect(src).not.toContain("source='calendar'")
  })

  it('the create affordance is identical for every customer', () => {
    const src = view()
    expect(src).toContain("<Btn lbl={t('calendar.page.newMeeting')} onClick={() => openNewMeeting()} />")
    expect(src).not.toContain("{!expired && <Btn lbl={t('calendar.page.newMeeting')}")
  })

  it('nothing is greyed out or withheld on the calendar surface', () => {
    const src = view()
    expect(src).toContain('selectable={true}')
    expect(src).toContain('editable={true}')
    expect(src).not.toMatch(/disabled=\{expired\}/)
    expect(src).not.toMatch(/\{!expired &&/)
  })

  /** The boundary still exists — it just lives in the handlers. */
  it.each([
    ['create', 'promptCreate()'],
    ['move', 'promptMove()'],
    ['cancel', "t('calendar.pro.cancel.title')"],
    ['sync retry', "t('calendar.pro.retry.title')"],
  ])('%s is still answered by the Pro prompt', (_l, marker) => {
    expect(view()).toContain(marker)
  })

  it('the details dialog carries no banner either', () => {
    const dlg = read('components/calendar/MeetingDetailsDialog.tsx')
    expect(dlg).not.toContain('SubscriptionExpiredState')
    expect(dlg).toContain('promptEdit')
    expect(dlg).toContain('promptOutcome')
  })
})
