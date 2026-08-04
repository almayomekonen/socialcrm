import { describe, expect, it, vi } from 'vitest'
import { runAutomationWorker, type WorkerDeps } from '@/lib/automations/worker'
import type { AutomationJob } from '@/db/automations/jobs'
import { MISSING_MEETING, occurrenceKeyForMeeting, type MeetingFacts } from '@/lib/automations/appointments'
import { getMeetingFactsQuery } from '@/db/automations/meetingFacts'
import { getAction } from '@/lib/automations/catalog/registry'
import { emailExecutor, type EmailDeps } from '@/lib/automations/executors/email'

/**
 * The reminder through the REAL worker — one delayed job, from claim to send.
 *
 * The unit tests pin each invariant; this pins that they are actually wired: the
 * meeting is read through the occurrence key, the guard runs before the claim,
 * and the email carries the live meeting values rather than what was true when
 * the meeting was booked.
 */

const MEETING_ID = 99
const STARTS_AT = new Date('2026-08-12T07:30:00Z')

const MEETING: MeetingFacts = {
  exists: true,
  status: 'scheduled',
  startsAt: STARTS_AT,
  endsAt: new Date('2026-08-12T08:00:00Z'),
  title: 'פגישת היכרות',
  location: 'רוטשילד 1, תל אביב',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  timezone: 'Asia/Jerusalem',
}

const job = (): AutomationJob => ({
  id: 1,
  agencyId: 7,
  automationId: 3,
  leadId: 42,
  trigger: 'appointment_booked',
  origin: 'manual',
  // The dedup key is the ONLY place the meeting id travels.
  eventKey: occurrenceKeyForMeeting(MEETING_ID),
  attempts: 1,
  maxAttempts: 3,
  createdAt: '2026-08-10T09:00:00.000Z',
})

/** The saved reminder: one hour before the meeting. */
const definition = () => ({
  id: 3,
  agencyId: 7,
  status: 'active',
  conditions: [],
  actions: [
    {
      actionKey: 'email.send',
      parameters: {
        subject: 'תזכורת: {{שם הפגישה}}',
        body: 'שלום {{שם הליד}},\n\nתזכורת לפגישה שלנו:\n\n{{פרטי הפגישה}}\n\nבברכה,\n{{שם העסק}}',
      },
    },
  ],
  content: {
    schemaVersion: 1,
    subject: 'תזכורת: {{שם הפגישה}}',
    body: 'שלום {{שם הליד}},\n\nתזכורת לפגישה שלנו:\n\n{{פרטי הפגישה}}\n\nבברכה,\n{{שם העסק}}',
    timing: { kind: 'before_anchor' as const, anchorField: 'startsAt', value: 1, unit: 'hours' as const },
  },
})

/** Captures what the transport was handed, so the email itself can be asserted. */
const sent: Array<{ subject: string; html: string; text: string }> = []

/**
 * The REAL email executor with only its I/O replaced.
 *
 * `defaultDeps()` normally reaches the database for the agency name and reply-to
 * and the transport for the send. Stubbing exactly those keeps the real
 * preflight, the real identity resolution and the real renderer in the path —
 * which is the point of this test.
 */
const emailDeps = (): EmailDeps => ({
  agencyName: async () => 'סטודיו אור',
  replyTo: async () => 'owner@business.example',
  repName: async () => null,
  from: () => 'bot@mail.example',
  send: async (args) => {
    sent.push({ subject: args.subject, html: args.html, text: args.text })
    return { ok: true as const, id: 'msg_1' }
  },
})

const stubbedEmailExecutor = { ...emailExecutor, defaultDeps: emailDeps }

function deps(over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    sendMode: () => 'live',
    reclaim: vi.fn(async () => 0),
    claim: vi.fn(async () => [job()]),
    getDefinition: vi.fn(async () => definition() as never),
    getLeadFacts: vi.fn(async () => ({
      exists: true as const,
      email: 'dana@example.com',
      phone: null,
      currentStatus: 'contacted',
      firstName: 'דנה',
      displayName: 'דנה לוי',
      handlerId: null,
    })),
    isSuppressed: vi.fn(async () => false),
    isOptedOut: vi.fn(async () => false),
    isRecipientBlocked: vi.fn(async () => false),
    claimState: vi.fn(async () => 'none' as const),
    claimOnce: vi.fn(async () => true),
    confirmClaim: vi.fn(async () => {}),
    releaseClaim: vi.fn(async () => {}),
    hasEffect: vi.fn(async () => false),
    countLeadToday: vi.fn(async () => 0),
    countAutoResponsesToday: vi.fn(async () => 0),
    countAgencyToday: vi.fn(async () => 0),
    appendActivity: vi.fn(async () => undefined as never),
    agencyName: vi.fn(async () => 'סטודיו אור'),
    repName: vi.fn(async () => null),
    meetingFacts: vi.fn(async () => MEETING),
    // The REAL catalog and the REAL executor: this test exists to prove the
    // wiring, so stubbing either would defeat it.
    getAction,
    executorFor: (key) => (key === 'email.send' ? (stubbedEmailExecutor as never) : null),
    completeJob: vi.fn(async () => {}),
    skipJob: vi.fn(async () => {}),
    failJob: vi.fn(async () => {}),
    deadJob: vi.fn(async () => {}),
    // An hour before the meeting: exactly when the job becomes due.
    now: () => new Date('2026-08-12T06:30:00Z'),
    ...over,
  }
}

describe('the reminder, end to end through the worker', () => {
  it('reads the meeting through the occurrence key and sends', async () => {
    const d = deps()
    const summary = await runAutomationWorker({ deps: d })

    expect(summary).toMatchObject({ claimed: 1, done: 1, skipped: 0, dead: 0 })
    expect(d.meetingFacts).toHaveBeenCalledWith(7, MEETING_ID)
    expect(d.skipJob).not.toHaveBeenCalled()
    expect(d.confirmClaim).toHaveBeenCalledWith(3, 42)
  })

  it('puts the LIVE meeting data in the email, formatted for the business timezone', async () => {
    sent.length = 0
    const activity = vi.fn(async () => undefined as never)
    await runAutomationWorker({ deps: deps({ appendActivity: activity }) })

    const row = (activity as ReturnType<typeof vi.fn>).mock.calls[0][0] as { kind: string; subject: string | null }
    expect(row.kind).toBe('sent')
    // The subject substituted the meeting's own title.
    expect(row.subject).toBe('תזכורת: פגישת היכרות')

    // And the body carries the details block, resolved from the meeting row.
    const email = sent[0]
    expect(email.subject).toBe('תזכורת: פגישת היכרות')
    expect(email.text).toContain('פגישת היכרות')
    // 07:30Z is 10:30 in Asia/Jerusalem — the business's time, not UTC.
    expect(email.text).toContain('10:30')
    expect(email.text).toContain('מקום: רוטשילד 1, תל אביב')
    expect(email.text).toContain('קישור לפגישה: https://meet.google.com/abc-defg-hij')
    // The lead's name and the business name, from the existing closed set.
    expect(email.text).toContain('שלום דנה')
    expect(email.text).toContain('סטודיו אור')
  })

  it('omits the location and Meet link when the meeting has none', async () => {
    sent.length = 0
    await runAutomationWorker({
      deps: deps({ meetingFacts: vi.fn(async () => ({ ...MEETING, location: null, meetUrl: null })) }),
    })
    expect(sent[0].text).not.toContain('מקום:')
    expect(sent[0].text).not.toContain('קישור לפגישה:')
    // The rest of the reminder is intact.
    expect(sent[0].text).toContain('פגישת היכרות')
  })

  for (const [label, meeting, reason] of [
    ['cancelled after booking', { ...MEETING, status: 'cancelled' }, 'meeting_cancelled'],
    ['deleted after booking', MISSING_MEETING, 'meeting_missing'],
  ] as const) {
    it(`skips when the meeting was ${label}, and never claims the send-once`, async () => {
      const d = deps({ meetingFacts: vi.fn(async () => meeting) })
      const summary = await runAutomationWorker({ deps: d })

      expect(summary).toMatchObject({ skipped: 1, done: 0 })
      expect(d.skipJob).toHaveBeenCalledWith(1, reason)
      // The lead's once-ever allowance must survive a skip, so a re-booked
      // meeting can still produce a reminder.
      expect(d.claimOnce).not.toHaveBeenCalled()
    })
  }

  it('skips a job that arrives after the meeting started — the outage case', async () => {
    // The worker was down; the job is claimed an hour LATE.
    const d = deps({ now: () => new Date('2026-08-12T08:30:00Z') })
    const summary = await runAutomationWorker({ deps: d })

    expect(summary).toMatchObject({ skipped: 1, done: 0 })
    expect(d.skipJob).toHaveBeenCalledWith(1, 'meeting_passed')
  })

  it('records the skip on the activity log so the customer can see why', async () => {
    const activity = vi.fn(async () => undefined as never)
    await runAutomationWorker({
      deps: deps({ appendActivity: activity, meetingFacts: vi.fn(async () => ({ ...MEETING, status: 'cancelled' })) }),
    })
    const row = (activity as ReturnType<typeof vi.fn>).mock.calls[0][0] as { kind: string; skipReason: string }
    expect(row.kind).toBe('skipped')
    expect(row.skipReason).toBe('meeting_cancelled')
  })

  it('never reads another agency\'s meeting', () => {
    // The agency filter is in the WHERE clause, not a check afterwards, so a
    // mismatched id returns "missing" instead of leaking existence.
    const sql = getMeetingFactsQuery(7, MEETING_ID).toSQL().sql.toLowerCase()
    expect(sql).toContain('agency_id')
    expect(sql).toContain('"meetings"')
  })
})
