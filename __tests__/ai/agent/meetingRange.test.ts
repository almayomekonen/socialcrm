import { describe, expect, it } from 'vitest'
import { meetingRange } from '@/lib/agent/meetingRange'

const at = (iso: string) => Date.parse(iso)

describe('meetingRange — the business day, not the server clock', () => {
  // Friday 2026-11-06 22:30 UTC is already Saturday 00:30 in Jerusalem (UTC+2).
  const AFTER_LOCAL_MIDNIGHT = at('2026-11-06T22:30:00Z')

  it('"today" just after Israeli midnight is the Israeli date, not the UTC one', () => {
    const r = meetingRange('today', AFTER_LOCAL_MIDNIGHT)!
    expect(r.fromDate).toBe('2026-11-07')
    expect(r.toDate).toBe('2026-11-07')
    expect(r.fromMs).toBe(at('2026-11-06T22:00:00Z'))
    expect(r.toMs).toBe(at('2026-11-07T22:00:00Z'))
  })

  it('"tomorrow" is the next Israeli calendar day', () => {
    const r = meetingRange('tomorrow', AFTER_LOCAL_MIDNIGHT)!
    expect([r.fromDate, r.toDate]).toEqual(['2026-11-08', '2026-11-08'])
  })

  it('weeks run Sunday to Saturday: Saturday still belongs to the week that started last Sunday', () => {
    const r = meetingRange('this_week', AFTER_LOCAL_MIDNIGHT)!
    expect([r.fromDate, r.toDate]).toEqual(['2026-11-01', '2026-11-07'])
    const n = meetingRange('next_week', AFTER_LOCAL_MIDNIGHT)!
    expect([n.fromDate, n.toDate]).toEqual(['2026-11-08', '2026-11-14'])
  })

  it('on a Sunday the week starts that same day', () => {
    const r = meetingRange('this_week', at('2026-11-08T08:00:00Z'))!
    expect([r.fromDate, r.toDate]).toEqual(['2026-11-08', '2026-11-14'])
  })

  it('a spring-forward day is 23 hours long and still exactly one calendar day', () => {
    const r = meetingRange('today', at('2027-03-26T10:00:00Z'))!
    expect(r.fromMs).toBe(at('2027-03-25T22:00:00Z'))
    expect(r.toMs).toBe(at('2027-03-26T21:00:00Z'))
    expect([r.fromDate, r.toDate]).toEqual(['2027-03-26', '2027-03-26'])
  })

  it('a fall-back day is 25 hours long and still exactly one calendar day', () => {
    const r = meetingRange('today', at('2026-10-25T10:00:00Z'))!
    expect(r.fromMs).toBe(at('2026-10-24T21:00:00Z'))
    expect(r.toMs).toBe(at('2026-10-25T22:00:00Z'))
    expect([r.fromDate, r.toDate]).toEqual(['2026-10-25', '2026-10-25'])
  })

  it('a week crossing the fall-back transition is still seven calendar days', () => {
    const r = meetingRange('this_week', at('2026-10-27T10:00:00Z'))!
    expect([r.fromDate, r.toDate]).toEqual(['2026-10-25', '2026-10-31'])
  })

  it('a specific date is that whole Israeli day; impossible dates are refused', () => {
    const r = meetingRange('date', AFTER_LOCAL_MIDNIGHT, '2026-12-01')!
    expect([r.fromDate, r.toDate]).toEqual(['2026-12-01', '2026-12-01'])
    expect(r.fromMs).toBe(at('2026-11-30T22:00:00Z'))
    expect(meetingRange('date', AFTER_LOCAL_MIDNIGHT, '2026-02-30')).toBeNull()
    expect(meetingRange('date', AFTER_LOCAL_MIDNIGHT, 'מחר')).toBeNull()
    expect(meetingRange('date', AFTER_LOCAL_MIDNIGHT)).toBeNull()
  })

  it('"upcoming" starts now and is open-ended; "next_7_days" ends at the start of the 8th day', () => {
    const now = at('2026-11-08T08:00:00Z')
    const u = meetingRange('upcoming', now)!
    expect(u.fromMs).toBe(now)
    expect(u.toMs).toBeNull()
    const w = meetingRange('next_7_days', now)!
    expect(w.fromMs).toBe(now)
    expect(w.toMs).toBe(at('2026-11-14T22:00:00Z'))
    expect(w.toDate).toBe('2026-11-14')
  })
})
