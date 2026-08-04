import { describe, expect, it, vi } from 'vitest'
import {
  MISSING_MEETING,
  appointmentBlock,
  formatMeetingDetails,
  formatMeetingWhen,
  meetingIdFromOccurrenceKey,
  occurrenceKeyForMeeting,
  type MeetingFacts,
} from '@/lib/automations/appointments'
import { isValidTiming, resolveSendAtDetailed, type Timing } from '@/lib/automations/timing'
import { decideSendForAction, type SendFacts } from '@/lib/automations/laws'
import { getAction, getEvent } from '@/lib/automations/catalog/registry'
import { getTemplate } from '@/lib/automations/templates/registry'
import { parseAnchorOffset, prepare, validateTemplate } from '@/lib/automations/templates/install'
import { subjectResolver } from '@/lib/automations/subject'
import { AUTOMATION_EMAIL_VARIABLES, substituteVariables } from '@/lib/automations/variables'
import { SKIP_REASON_COPY } from '@/lib/automations/copy'
import { timingKey, timingOptionsFor } from '@/components/settings/automations/sheetOptions'

/**
 * THE APPOINTMENT REMINDER.
 *
 * Source of truth is the CRM's own meeting. No calendar provider is in the path,
 * and no scheduling subsystem was added — a before-anchor timing only changes
 * the arithmetic that produces `automation_jobs.notBefore`, which the queue has
 * always used.
 */

const MEETING: MeetingFacts = {
  exists: true,
  status: 'scheduled',
  startsAt: new Date('2026-08-12T07:30:00Z'),
  endsAt: new Date('2026-08-12T08:00:00Z'),
  title: 'פגישת היכרות',
  location: 'רוטשילד 1, תל אביב',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
  timezone: 'Asia/Jerusalem',
}

describe('occurrence identity — the only channel the meeting id travels through', () => {
  it('round-trips a meeting id', () => {
    expect(meetingIdFromOccurrenceKey(occurrenceKeyForMeeting(42))).toBe(42)
  })

  it('refuses keys it did not write, rather than guessing', () => {
    for (const key of ['appointment:other-source', 'appointment:meeting:abc', 'lead_created', '', null, undefined]) {
      expect(meetingIdFromOccurrenceKey(key as string | null)).toBeNull()
    }
  })
})

describe('before-anchor timing — reminders count back from the meeting', () => {
  const anchorTiming = (value: number, unit: 'hours' | 'days'): Timing => ({
    kind: 'before_anchor',
    anchorField: 'startsAt',
    value,
    unit,
  })

  it('lands the send the requested offset before the anchor', () => {
    const booked = new Date('2026-08-10T09:00:00Z')
    const hour = resolveSendAtDetailed(booked, anchorTiming(1, 'hours'), { startsAt: MEETING.startsAt })
    const day = resolveSendAtDetailed(booked, anchorTiming(1, 'days'), { startsAt: MEETING.startsAt })
    expect(hour.at?.toISOString()).toBe('2026-08-12T06:30:00.000Z')
    expect(day.at?.toISOString()).toBe('2026-08-11T07:30:00.000Z')
  })

  it('accepts an anchor delivered as an ISO string, as jsonb round-trips it', () => {
    const res = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), anchorTiming(1, 'hours'), {
      startsAt: '2026-08-12T07:30:00.000Z',
    })
    expect(res.at?.toISOString()).toBe('2026-08-12T06:30:00.000Z')
  })

  it('produces NO job when the meeting is too soon for the offset', () => {
    // Booked twenty minutes before it starts: there is no "one hour before"
    // moment left, and inventing one would email about a meeting under way.
    const booked = new Date('2026-08-12T07:10:00Z')
    const res = resolveSendAtDetailed(booked, anchorTiming(1, 'hours'), { startsAt: MEETING.startsAt })
    expect(res.at).toBeNull()
    expect(res.miss).toBe('anchor_too_late')
  })

  it('produces NO job when the occurrence carries no anchor', () => {
    for (const anchors of [{}, { startsAt: null }, { startsAt: 'not-a-date' }]) {
      const res = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), anchorTiming(1, 'days'), anchors)
      expect(res.at).toBeNull()
      expect(res.miss).toBe('anchor_missing')
    }
  })

  it('is resolved against the TRIGGER moment, so emission is deterministic', () => {
    const args = [anchorTiming(1, 'hours'), { startsAt: MEETING.startsAt }] as const
    const a = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), ...args)
    const b = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), ...args)
    expect(a.at?.toISOString()).toBe(b.at?.toISOString())
  })

  it('validates the anchor field, and keeps delay timings valid', () => {
    expect(isValidTiming(anchorTiming(1, 'hours'))).toBe(true)
    expect(isValidTiming({ kind: 'before_anchor', anchorField: '', value: 1, unit: 'hours' })).toBe(false)
    expect(isValidTiming({ kind: 'preset', preset: 'immediate' })).toBe(true)
    expect(isValidTiming({ kind: 'custom', value: 3, unit: 'days' })).toBe(true)
  })
})

describe('the send-time guard — three things that must still be true', () => {
  const NOW = new Date('2026-08-11T07:30:00Z')

  it('allows a scheduled meeting still in the future', () => {
    expect(appointmentBlock(MEETING, NOW)).toBeNull()
  })

  it('blocks a meeting that no longer exists', () => {
    expect(appointmentBlock(MISSING_MEETING, NOW)).toBe('meeting_missing')
  })

  it('blocks a cancelled meeting', () => {
    expect(appointmentBlock({ ...MEETING, status: 'cancelled' }, NOW)).toBe('meeting_cancelled')
  })

  it('blocks a meeting that has already started — the late-job case', () => {
    const afterStart = new Date(MEETING.startsAt!.getTime() + 60_000)
    expect(appointmentBlock(MEETING, afterStart)).toBe('meeting_passed')
    // Exactly at the start time is already too late.
    expect(appointmentBlock(MEETING, MEETING.startsAt!)).toBe('meeting_passed')
  })

  it('does not block a completed meeting that is still in the future', () => {
    // Marking an outcome early is a rep's business, not a reason to withhold a
    // reminder for a meeting that has not happened yet.
    expect(appointmentBlock({ ...MEETING, status: 'completed' }, NOW)).toBeNull()
  })
})

describe('the guard is an ENGINE invariant, reached through the law pipeline', () => {
  const action = getAction('email.send')!
  const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
    event: {
      trigger: 'appointment_booked',
      origin: 'manual',
      agencyId: 7,
      leadId: 42,
      occurredAt: new Date('2026-08-10T09:00:00Z'),
    },
    lead: { exists: true, currentStatus: 'contacted' },
    recipients: { email: { value: 'dana@example.com', blocked: false } },
    appointment: MEETING,
    suppressed: false,
    alreadySent: false,
    sentToLeadToday: 0,
    sentByAgencyToday: 0,
    now: new Date('2026-08-11T07:30:00Z'),
    ...over,
  })

  it('allows a clean reminder', () => {
    expect(decideSendForAction(action, facts())).toEqual({ allow: true })
  })

  for (const [label, over, reason] of [
    ['cancelled', { appointment: { ...MEETING, status: 'cancelled' } }, 'meeting_cancelled'],
    ['deleted', { appointment: MISSING_MEETING }, 'meeting_missing'],
    ['already started', { now: new Date('2026-08-12T08:00:00Z') }, 'meeting_passed'],
    ['unreadable', { appointment: null }, 'meeting_missing'],
  ] as const) {
    it(`skips a ${label} meeting with reason "${reason}"`, () => {
      expect(decideSendForAction(action, facts(over as Partial<SendFacts>))).toEqual({ allow: false, reason })
    })
  }

  it('leaves every other trigger untouched by the appointment guard', () => {
    const leadJob = facts({
      event: { ...facts().event, trigger: 'lead_created' },
      // No appointment facts gathered, which must not block a lead automation.
      appointment: null,
    })
    expect(decideSendForAction(action, leadJob)).toEqual({ allow: true })
  })

  it('has Hebrew copy for every new reason', () => {
    for (const reason of ['meeting_missing', 'meeting_cancelled', 'meeting_passed'] as const) {
      expect(SKIP_REASON_COPY[reason]).toMatch(/^לא נשלח —/)
    }
  })
})

describe('email content — resolved from the live meeting, in the business timezone', () => {
  const deps = {
    agencyName: vi.fn(async () => 'סטודיו אור'),
    repName: vi.fn(async () => null),
    meetingFacts: vi.fn(async () => MEETING),
  }
  const lead = { exists: true as const, email: 'dana@example.com', phone: null, currentStatus: 'contacted', firstName: 'דנה', displayName: 'דנה לוי', handlerId: null }

  it('formats the moment in Asia/Jerusalem, not UTC', () => {
    // 07:30Z in August is 10:30 local — the business's fact, not the device's.
    expect(formatMeetingWhen(MEETING.startsAt, 'Asia/Jerusalem')).toContain('10:30')
  })

  it('falls back to the business timezone when the stored one is unusable', () => {
    expect(formatMeetingWhen(MEETING.startsAt, 'Not/AZone')).toContain('10:30')
  })

  it('omits absent details instead of leaving a dangling label', () => {
    const full = formatMeetingDetails(MEETING)
    expect(full).toContain('פגישת היכרות')
    expect(full).toContain('מקום: רוטשילד 1, תל אביב')
    expect(full).toContain('קישור לפגישה: https://meet.google.com/abc-defg-hij')

    const bare = formatMeetingDetails({ ...MEETING, location: null, meetUrl: null })
    expect(bare).not.toContain('מקום:')
    expect(bare).not.toContain('קישור לפגישה:')
    expect(bare.split('\n').every((l) => l.trim().length > 0)).toBe(true)
  })

  it('resolves meeting fields through the occurrence key, reading the row ONCE', async () => {
    deps.meetingFacts.mockClear()
    const resolve = subjectResolver(7, lead, deps, occurrenceKeyForMeeting(99))
    const values = await resolve(['meetingStatus', 'meetingTitle', 'meetingWhen', 'meetingDetails'])
    expect(values.meetingStatus).toBe('scheduled')
    expect(values.meetingTitle).toBe('פגישת היכרות')
    expect(String(values.meetingWhen)).toContain('10:30')
    expect(String(values.meetingDetails)).toContain('מקום:')
    // Four meeting-scoped fields, one query.
    expect(deps.meetingFacts).toHaveBeenCalledTimes(1)
    expect(deps.meetingFacts).toHaveBeenCalledWith(7, 99)
  })

  it('resolves to the missing-meeting state when there is no occurrence key', async () => {
    const resolve = subjectResolver(7, lead, deps, null)
    const values = await resolve(['meetingStatus', 'meetingDetails'])
    expect(values.meetingStatus).toBeNull()
    expect(values.meetingDetails).toBe('')
  })
})

describe('every token in the closed set actually substitutes', () => {
  /**
   * The bug this pins: `substituteVariables` resolved from a hand-written list of
   * three fields, so a token added to the vocabulary rendered as an EMPTY STRING.
   * Every unit test passed — each checked one substitution it knew about — and
   * only an end-to-end send revealed "תזכורת:" with no meeting name.
   *
   * Asserted over the vocabulary rather than over a list, so the next token added
   * is covered without anyone remembering to come back here.
   */
  it('leaves no token unresolved and no token empty', () => {
    const vars: Record<string, string> = {
      leadFirstName: 'דנה',
      businessName: 'סטודיו אור',
      repName: 'יעל',
      meetingTitle: 'פגישת היכרות',
      meetingWhen: 'יום שלישי, 12 באוגוסט, 10:30',
      meetingDetails: 'פגישת היכרות\nיום שלישי, 12 באוגוסט, 10:30',
    }
    for (const variable of AUTOMATION_EMAIL_VARIABLES) {
      const out = substituteVariables(`[{{${variable.token}}}]`, vars)
      expect(out, `token "${variable.token}" was not substituted`).not.toContain('{{')
      expect(out, `token "${variable.token}" substituted to empty`).not.toBe('[]')
      expect(out).toContain(vars[variable.field].split('\n')[0])
    }
  })

  it('keeps the graceful degradation for an absent first name', () => {
    expect(substituteVariables('שלום {{שם הליד}},', { businessName: 'סטודיו אור' })).toBe('שלום,')
  })

  it('resolves a rep-less business to its own name, not to nothing', () => {
    expect(substituteVariables('{{שם הנציג}}', { businessName: 'סטודיו אור' })).toBe('סטודיו אור')
  })

  it('resolves an absent meeting token to nothing rather than a raw token', () => {
    // A lead automation referencing a meeting token has no meeting behind it.
    expect(substituteVariables('[{{שם הפגישה}}]', { businessName: 'סטודיו אור' })).toBe('[]')
  })
})

describe('the template', () => {
  const template = getTemplate('appointment_reminder')!

  it('is registered, named, and installable', () => {
    expect(template.title).toBe('תזכורת לפני פגישה')
    expect(validateTemplate(template)).toEqual([])
    // Works for every agency: nothing to connect.
    expect(template.requirements).toEqual([])
  })

  it('offers exactly 1 hour before and 1 day before', () => {
    const options = template.variables[0].options?.map((o) => o.value)
    expect(options).toEqual(['1h', '1d'])
  })

  it("honours the customer's choice instead of discarding it", () => {
    const hour = prepare(template, { remindBefore: '1h' })[0]
    const day = prepare(template, { remindBefore: '1d' })[0]
    expect(hour.timing).toEqual({ kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'hours' })
    expect(day.timing).toEqual({ kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'days' })
  })

  it('falls back to valid timing rather than none when the value is unusable', () => {
    const prepared = prepare(template, { remindBefore: 'nonsense' })[0]
    expect(isValidTiming(prepared.timing)).toBe(true)
    expect(prepared.timing).toEqual(template.automations[0].timing)
  })

  it('uses only tokens the email action can resolve', () => {
    const body = template.automations[0].parameters.body
    expect(body).toContain('{{שם הליד}}')
    expect(body).toContain('{{פרטי הפגישה}}')
  })

  it('parses offsets, and refuses ones it cannot', () => {
    expect(parseAnchorOffset('2h', 'startsAt')).toEqual({ kind: 'before_anchor', anchorField: 'startsAt', value: 2, unit: 'hours' })
    for (const bad of ['', '0h', '1w', 'h1', undefined]) expect(parseAnchorOffset(bad, 'startsAt')).toBeNull()
  })
})

describe('the appointment event is produced internally now', () => {
  const event = getEvent('appointment.booked')!

  it('needs no connection and offers no remote picker', () => {
    expect(event.requirements).toEqual([])
    expect(event.parameters).toEqual([])
    expect(event.origin).toBe('internal')
  })

  it('declares startsAt as a datetime the Builder can anchor to', () => {
    const anchor = event.fields.find((f) => f.key === 'startsAt')
    expect(anchor?.type).toBe('datetime')
  })

  it('offers the email action, so the template is installable', () => {
    expect(event.fields.some((f) => f.key === 'email')).toBe(true)
  })
})

describe('the Builder cannot silently destroy an anchored timing', () => {
  const anchored: Timing = { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'hours' }

  it('gives an anchored timing its own stable key', () => {
    // The old implementation returned 'one_day' here, so saving the sheet wrote
    // a delay preset over the reminder.
    expect(timingKey(anchored)).not.toBe('one_day')
    expect(timingKey(anchored)).toBe('before:startsAt:1h')
  })

  it('renders the saved timing as a selectable option so it round-trips', () => {
    const options = timingOptionsFor(anchored)
    const match = options.find((o) => o.key === timingKey(anchored))
    expect(match, 'anchored timing is not offered, so saving would replace it').toBeDefined()
    expect(match?.timing).toEqual(anchored)
    expect(match?.lbl).toBe('שעה לפני המועד')
  })

  it('leaves the preset list alone for ordinary delays', () => {
    expect(timingOptionsFor({ kind: 'preset', preset: 'immediate' }).length).toBe(4)
  })
})
