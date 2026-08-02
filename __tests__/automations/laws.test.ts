import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENCY_DAILY_CEILING,
  DEFAULT_LEAD_DAILY_CAP,
  decideSend,
  isTerminalStatus,
  sendOnceKey,
  type SendFacts,
} from '@/lib/automations/laws'
import type { AutomationTriggerEvent, TriggerOrigin } from '@/lib/automations/types'

// Pure-law coverage (DB-less): one allow path, every skip reason, the
// first-skip-wins order, and the CSV-footgun guarantee — import origin is
// inert regardless of every other fact.

const NOON_UTC = new Date('2026-08-02T12:00:00Z') // 15:00 in Asia/Jerusalem (IDT)

function event(overrides: Partial<AutomationTriggerEvent> = {}): AutomationTriggerEvent {
  return {
    trigger: 'lead_created',
    origin: 'webhook_facebook',
    agencyId: 7,
    leadId: 42,
    occurredAt: NOON_UTC,
    ...overrides,
  }
}

function facts(overrides: Partial<SendFacts> = {}): SendFacts {
  return {
    event: event(),
    lead: { exists: true, email: 'lead@example.com', currentStatus: 'new', emailUndeliverable: false },
    suppressed: false,
    alreadySent: false,
    sentToLeadToday: 0,
    sentByAgencyToday: 0,
    now: NOON_UTC,
    ...overrides,
  }
}

describe('decideSend — allow path', () => {
  it('allows a clean webhook lead_created event', () => {
    expect(decideSend(facts())).toEqual({ allow: true })
  })

  it('allows manual origin (ADR-004: manual fires lead_created)', () => {
    expect(decideSend(facts({ event: event({ origin: 'manual' }) }))).toEqual({ allow: true })
  })

  it('allows a status_changed automation whose premise still holds', () => {
    const f = facts({
      event: event({ trigger: 'status_changed', newStatus: 'closed' }),
      expectedStatus: 'closed',
      lead: { exists: true, email: 'lead@example.com', currentStatus: 'closed', emailUndeliverable: false },
    })
    expect(decideSend(f)).toEqual({ allow: true })
  })
})

describe('decideSend — the CSV footgun (ADR-004)', () => {
  it('import origin is inert even when every other fact is perfect', () => {
    expect(decideSend(facts({ event: event({ origin: 'import' }) }))).toEqual({
      allow: false,
      reason: 'origin_import',
    })
  })

  it('import origin wins over every other skip (first law checked)', () => {
    const worstCase = facts({
      event: event({ origin: 'import' }),
      lead: { exists: false, email: null, currentStatus: 'closed', emailUndeliverable: true },
      suppressed: true,
      alreadySent: true,
      sentToLeadToday: 99,
      sentByAgencyToday: 9999,
    })
    expect(decideSend(worstCase)).toEqual({ allow: false, reason: 'origin_import' })
  })
})

describe('decideSend — each skip reason', () => {
  it('lead_deleted when the lead no longer exists', () => {
    const f = facts({ lead: { exists: false, email: null, currentStatus: null, emailUndeliverable: false } })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'lead_deleted' })
  })

  it('premise_expired: lead_created send pending while the lead turned terminal', () => {
    const f = facts({ lead: { exists: true, email: 'a@b.co', currentStatus: 'closed', emailUndeliverable: false } })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'premise_expired' })
  })

  it('premise_expired: status_changed send whose status moved on', () => {
    const f = facts({
      event: event({ trigger: 'status_changed', newStatus: 'contacted' }),
      expectedStatus: 'contacted',
      lead: { exists: true, email: 'a@b.co', currentStatus: 'interested', emailUndeliverable: false },
    })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'premise_expired' })
  })

  it('suppressed after unsubscribe', () => {
    expect(decideSend(facts({ suppressed: true }))).toEqual({ allow: false, reason: 'suppressed' })
  })

  it('no_email when the address is missing or blank', () => {
    const noEmail = facts({ lead: { exists: true, email: null, currentStatus: 'new', emailUndeliverable: false } })
    const blank = facts({ lead: { exists: true, email: '   ', currentStatus: 'new', emailUndeliverable: false } })
    expect(decideSend(noEmail)).toEqual({ allow: false, reason: 'no_email' })
    expect(decideSend(blank)).toEqual({ allow: false, reason: 'no_email' })
  })

  it('address_undeliverable after a hard bounce', () => {
    const f = facts({ lead: { exists: true, email: 'a@b.co', currentStatus: 'new', emailUndeliverable: true } })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'address_undeliverable' })
  })

  it('already_sent enforces once-per-lead-per-automation (ADR-005)', () => {
    expect(decideSend(facts({ alreadySent: true }))).toEqual({ allow: false, reason: 'already_sent' })
  })

  it('lead_daily_cap at the default of 2', () => {
    expect(DEFAULT_LEAD_DAILY_CAP).toBe(2)
    expect(decideSend(facts({ sentToLeadToday: 2 }))).toEqual({ allow: false, reason: 'lead_daily_cap' })
    expect(decideSend(facts({ sentToLeadToday: 1 }))).toEqual({ allow: true })
  })

  it('agency_daily_cap at the engine ceiling', () => {
    expect(decideSend(facts({ sentByAgencyToday: DEFAULT_AGENCY_DAILY_CEILING }))).toEqual({
      allow: false,
      reason: 'agency_daily_cap',
    })
  })

  it('respects per-automation limit overrides', () => {
    const f = facts({ sentToLeadToday: 1, limits: { leadDailyCap: 1 } })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'lead_daily_cap' })
  })

  it('quiet_hours inside a configured window (BUSINESS_TZ)', () => {
    // 12:00Z = 15:00 Jerusalem — inside a 14..18 quiet window.
    const f = facts({ quietHours: { startHour: 14, endHour: 18 } })
    expect(decideSend(f)).toEqual({ allow: false, reason: 'quiet_hours' })
  })
})

describe('decideSend — ordering contract', () => {
  it('suppression outranks missing email; dedup outranks caps', () => {
    const suppressedNoEmail = facts({
      suppressed: true,
      lead: { exists: true, email: null, currentStatus: 'new', emailUndeliverable: false },
    })
    expect(decideSend(suppressedNoEmail)).toEqual({ allow: false, reason: 'suppressed' })

    const dupAndCapped = facts({ alreadySent: true, sentToLeadToday: 99 })
    expect(decideSend(dupAndCapped)).toEqual({ allow: false, reason: 'already_sent' })
  })
})

describe('helpers', () => {
  it.each(['closed', 'lost'])('isTerminalStatus(%s) is true', (s) => {
    expect(isTerminalStatus(s)).toBe(true)
  })

  it.each(['new', 'contacted', 'interested', null, undefined])('isTerminalStatus(%s) is false', (s) => {
    expect(isTerminalStatus(s as string | null | undefined)).toBe(false)
  })

  it('sendOnceKey carries the explicit ADR-005 semantics component', () => {
    expect(sendOnceKey(12, 34)).toBe('auto:12:lead:34:ever')
  })

  it('origin values are the frozen ADR-004 taxonomy', () => {
    const origins: TriggerOrigin[] = ['webhook_facebook', 'webhook_whatsapp', 'manual', 'import']
    expect(origins).toHaveLength(4)
  })
})
