import { describe, expect, it, vi } from 'vitest'
import { discardPendingJobsForOccurrenceQuery, enqueueAutomationJobQuery } from '@/db/automations/jobs'
import { occurrenceKeyForMeeting } from '@/lib/automations/appointments'
import { emitAutomationEventWith, eventKeyFor, type EmitDeps } from '@/lib/automations/emit'
import type { AutomationDefinition } from '@/db/automations/definitions'
import { resolveSendAtDetailed, type Timing } from '@/lib/automations/timing'
import { db } from '@/config/db'

/**
 * RESCHEDULING — the reminder follows the meeting.
 *
 * The mechanism is deliberately two existing pieces rather than a new one: drop
 * the PENDING jobs for this occurrence, then re-emit it. Re-emission recomputes
 * `notBefore` from the new anchor through the ordinary emit path, so no
 * scheduling logic is duplicated and nothing new schedules anything.
 */

const MEETING_ID = 99
const OCCURRENCE = occurrenceKeyForMeeting(MEETING_ID)

const REMINDER: Timing = { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'hours' }

const definition = (timing: Timing = REMINDER) =>
  ({
    id: 3,
    agencyId: 7,
    name: 'תזכורת לפני פגישה',
    recipeKey: null,
    status: 'active',
    trigger: 'appointment_booked',
    action: 'send_email',
    content: { schemaVersion: 1, subject: 's', body: 'b', timing },
    createdByUserId: 1,
    conditions: [],
    actions: [{ actionKey: 'email.send', parameters: { subject: 's', body: 'b' } }],
    connectionId: null,
    sourceIds: [],
  }) as unknown as AutomationDefinition

const emitDeps = (defs: AutomationDefinition[]) => {
  const enqueue = vi.fn(async () => 1)
  const deps: EmitDeps = {
    enabled: () => true,
    allowlisted: () => true,
    listActive: vi.fn(async () => defs),
    enqueue,
    shadow: vi.fn(async () => {}),
  }
  return { deps, enqueue }
}

const bookingEvent = (startsAt: Date, occurredAt = new Date('2026-08-10T09:00:00Z')) => ({
  trigger: 'appointment_booked' as const,
  origin: 'manual' as const,
  agencyId: 7,
  leadId: 42,
  occurredAt,
  occurrenceKey: OCCURRENCE,
  fields: { startsAt, appointmentName: 'פגישת היכרות' },
})

describe('the discard is scoped to exactly what may be re-aimed', () => {
  // knex query builders are inspectable without a connection
  const sql = discardPendingJobsForOccurrenceQuery(db, { agencyId: 7, eventKey: OCCURRENCE }).toSQL()

  it('deletes, rather than tombstoning — a tombstone would keep blocking the re-emit', () => {
    expect(sql.sql.toLowerCase()).toContain('delete')
  })

  it('is bound to one agency, one occurrence, and only PENDING work', () => {
    const text = sql.sql.toLowerCase()
    expect(text).toContain('"agencyid"')
    expect(text).toContain('"eventkey"')
    expect(text).toContain('status')
    expect(sql.bindings).toContain(7)
    expect(sql.bindings).toContain(OCCURRENCE)
    // The bound status is what protects sent and already-decided work.
    expect(sql.bindings).toContain('pending')
  })
})

describe('re-emission aims the reminder at the new time', () => {
  it('computes notBefore from the NEW start, not the old one', async () => {
    const { deps, enqueue } = emitDeps([definition()])
    await emitAutomationEventWith(deps, bookingEvent(new Date('2026-08-20T07:30:00Z')))

    const args = (enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0] as { notBefore: Date; eventKey: string }
    // One hour before the new start.
    expect(args.notBefore.toISOString()).toBe('2026-08-20T06:30:00.000Z')
    // Same occurrence key, which is what makes the replacement land.
    expect(args.eventKey).toBe(OCCURRENCE)
  })

  it('keeps the occurrence key stable across reschedules, so the queue dedups on it', () => {
    const first = eventKeyFor(bookingEvent(new Date('2026-08-12T07:30:00Z')))
    const second = eventKeyFor(bookingEvent(new Date('2026-08-20T07:30:00Z')))
    expect(first).toBe(second)
    expect(first).toBe(OCCURRENCE)
  })

  it('produces NO job when the meeting is moved to less than the offset away', async () => {
    const { deps, enqueue } = emitDeps([definition()])
    // Moved to 20 minutes from now: there is no "one hour before" left.
    const res = await emitAutomationEventWith(
      deps,
      bookingEvent(new Date('2026-08-10T09:20:00Z'), new Date('2026-08-10T09:00:00Z')),
    )
    expect(res).toMatchObject({ emitted: 0 })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('produces NO job when the meeting is moved into the past', async () => {
    const { deps, enqueue } = emitDeps([definition()])
    const res = await emitAutomationEventWith(
      deps,
      bookingEvent(new Date('2026-08-09T09:00:00Z'), new Date('2026-08-10T09:00:00Z')),
    )
    expect(res).toMatchObject({ emitted: 0 })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('re-aims each automation by ITS OWN offset', async () => {
    const dayBefore: Timing = { kind: 'before_anchor', anchorField: 'startsAt', value: 1, unit: 'days' }
    const { deps, enqueue } = emitDeps([definition(REMINDER), { ...definition(dayBefore), id: 4 } as AutomationDefinition])
    await emitAutomationEventWith(deps, bookingEvent(new Date('2026-08-20T07:30:00Z')))

    const calls = (enqueue as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { notBefore: Date }).notBefore.toISOString())
    expect(calls).toEqual(['2026-08-20T06:30:00.000Z', '2026-08-19T07:30:00.000Z'])
  })
})

describe('the queue is what enforces "already reminded stays reminded"', () => {
  it('re-inserts on the same (automation, lead, occurrence) key, so a surviving row wins', () => {
    const sql = enqueueAutomationJobQuery(db, {
      agencyId: 7,
      automationId: 3,
      leadId: 42,
      trigger: 'appointment_booked',
      origin: 'manual',
      eventKey: OCCURRENCE,
      notBefore: new Date('2026-08-20T06:30:00Z'),
    }).toSQL()

    const text = sql.sql.toLowerCase()
    // A `done` or `skipped` row is NOT deleted, and this clause is what makes it
    // block the re-insert — so a lead who was already reminded is not reminded
    // twice by a reschedule.
    expect(text).toContain('on conflict')
    expect(text).toContain('do nothing')
    expect(text).toContain('"automationid","leadid","eventkey"')
  })
})

describe('a reschedule can never cost the user their meeting edit', () => {
  it('swallows a queue failure instead of failing the edit', async () => {
    // The CRM has already committed the new time by the time this runs. Reporting
    // the edit as failed would leave the user retrying something that succeeded.
    const { rescheduleAppointmentReminders } = await import('@/actions/calendar/shared')
    await expect(
      rescheduleAppointmentReminders({
        agencyId: 7,
        meetingId: MEETING_ID,
        leadId: 42,
        startAt: new Date('2026-08-20T07:30:00Z'),
        title: 'פגישת היכרות',
      }),
    ).resolves.toBeUndefined()
  })
})

describe('a reschedule only matters when the START moved', () => {
  it('the anchor is the only field the schedule depends on', () => {
    const at = (startsAt: Date) => resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), REMINDER, { startsAt })?.at
    // Same start, same due moment — nothing to re-aim.
    expect(at(new Date('2026-08-12T07:30:00Z'))?.toISOString()).toBe(at(new Date('2026-08-12T07:30:00Z'))?.toISOString())
    // Different start, different due moment.
    expect(at(new Date('2026-08-12T07:30:00Z'))?.toISOString()).not.toBe(at(new Date('2026-08-13T07:30:00Z'))?.toISOString())
  })

  it('title and location are absent from the anchor, because they are read live', () => {
    // Editing them needs no requeue: the queued job resolves them at send time.
    const withTitle = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), REMINDER, {
      startsAt: new Date('2026-08-12T07:30:00Z'),
      appointmentName: 'renamed',
    })
    const without = resolveSendAtDetailed(new Date('2026-08-10T09:00:00Z'), REMINDER, {
      startsAt: new Date('2026-08-12T07:30:00Z'),
    })
    expect(withTitle.at?.toISOString()).toBe(without.at?.toISOString())
  })
})
