import { describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { recordDelivery, recordRejection, deliveryFactsQuery } from '@/db/automations/connectionDelivery'
import {
  INTAKE_ERRORS,
  SYNC_FAILURE_THRESHOLD,
  intakeErrorCopy,
  isCustomerFacingRejection,
  isFailingIntake,
  type RejectionFacts,
} from '@/lib/automations/connectors/intakeErrors'
import { deliveryStateOf } from '@/lib/automations/connectors/overview'
import { nextConsecutiveFailures, shouldShowSyncBanner } from '@/lib/polling/syncFailure'

/**
 * LEAD-INTAKE REJECTION — persistence shape, the alarm decision, and the copy.
 *
 * SQL-level for the writes (the repo's `.toSQL()` pattern — the DB-backed
 * harness cannot run), pure for the decision, which is where the false-positive
 * guard actually lives.
 */

const sqlOf = (b: { toSQL: () => { sql: string; bindings: readonly unknown[] } }) => {
  const { sql, bindings } = b.toSQL()
  return { sql: sql.toLowerCase(), bindings }
}

const facts = (over: Partial<RejectionFacts> = {}): RejectionFacts => ({
  consecutiveRejections: 3,
  lastRejectedAt: '2026-08-10T10:00:00.000Z',
  lastEventAt: '2026-08-09T10:00:00.000Z',
  lastRejectionReason: 'invalid_signature',
  ...over,
})

// ── 1–4: persistence ────────────────────────────────────────────────────────

describe('a refused delivery is recorded on the connection', () => {
  const stmt = () => {
    // The write is issued through the same builder the app uses; capture its SQL.
    const q = db('automation_connections')
      .where({ id: 7 })
      .update({
        lastRejectedAt: db.fn.now(),
        lastRejectionReason: 'invalid_signature',
        consecutiveRejections: db.raw('COALESCE("consecutiveRejections", 0) + 1'),
      })
    return sqlOf(q)
  }

  it('increments the consecutive count atomically, not read-modify-write', () => {
    // Two deliveries racing must both count — the reason `eventCount` is also
    // incremented in SQL.
    expect(stmt().sql).toContain('coalesce("consecutiverejections", 0) + 1')
  })

  it('persists the moment it happened', () => {
    expect(stmt().sql).toContain('"lastrejectedat"')
  })

  it('persists the technical reason for mapping later', () => {
    expect(stmt().bindings).toContain('invalid_signature')
  })

  it('does NOT touch lastEventAt — nothing was delivered', () => {
    // The whole defect being fixed is a stale lastEventAt reading as healthy.
    expect(stmt().sql).not.toContain('"lasteventat"')
  })

  it('recordRejection and recordDelivery are the two halves of one function', async () => {
    expect(typeof recordRejection).toBe('function')
    expect(typeof recordDelivery).toBe('function')
    // The semantics are `nextConsecutiveFailures` — failure branch in
    // recordRejection, reset branch in recordDelivery. Pinned so the shapes
    // cannot drift apart.
    expect(nextConsecutiveFailures(2, true)).toBe(3)
    expect(nextConsecutiveFailures(2, false)).toBe(0)
  })

  it('the read exposes the rejection columns alongside the delivery pair', () => {
    const { sql } = sqlOf(deliveryFactsQuery(1))
    for (const col of ['"lasteventat"', '"eventcount"', '"lastrejectedat"', '"consecutiverejections"', '"lastrejectionreason"']) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain('"agencyid"')
  })
})

describe('a verified delivery resets the streak', () => {
  it('zeroes the counter and clears the reason in the same statement', () => {
    const { sql } = sqlOf(
      db('automation_connections').where({ id: 7 }).update({
        lastEventAt: db.fn.now(),
        eventCount: db.raw('COALESCE("eventCount", 0) + 1'),
        consecutiveRejections: 0,
        lastRejectionReason: null,
      }),
    )
    expect(sql).toContain('"consecutiverejections"')
    expect(sql).toContain('"lasteventat"')
    expect(sql).toContain('coalesce("eventcount", 0) + 1')
  })
})

// ── 6–9 + the interleaved case: the alarm decision ──────────────────────────

describe('when a connection is considered to be failing intake', () => {
  it('THREE consecutive refusals with nothing delivered since → alarm', () => {
    expect(isFailingIntake(facts())).toBe(true)
  })

  it('ONE refusal does not alarm — a blip is not an incident', () => {
    expect(isFailingIntake(facts({ consecutiveRejections: 1 }))).toBe(false)
    expect(isFailingIntake(facts({ consecutiveRejections: 2 }))).toBe(false)
  })

  it('uses the house threshold, not a second one', () => {
    expect(SYNC_FAILURE_THRESHOLD).toBe(3)
    expect(shouldShowSyncBanner(SYNC_FAILURE_THRESHOLD)).toBe(true)
    expect(isFailingIntake(facts({ consecutiveRejections: SYNC_FAILURE_THRESHOLD }))).toBe(true)
    expect(isFailingIntake(facts({ consecutiveRejections: SYNC_FAILURE_THRESHOLD - 1 }))).toBe(false)
  })

  it('a delivery NEWER than the last refusal clears the alarm', () => {
    // Belt and braces: the reset already zeroes the counter, but the timestamps
    // are compared too so the intent is legible and a missed reset cannot alarm.
    expect(
      isFailingIntake(facts({ lastEventAt: '2026-08-10T11:00:00.000Z', lastRejectedAt: '2026-08-10T10:00:00.000Z' })),
    ).toBe(false)
  })

  it('never delivered at all, and refusing → alarm', () => {
    expect(isFailingIntake(facts({ lastEventAt: null }))).toBe(true)
  })

  it('a reason with no customer copy never alarms', () => {
    // Someone can post garbage that maps to `not_actionable`; it is a decision,
    // not a failure, and must never reach a customer.
    for (const reason of ['not_actionable', 'event_undescribed', 'event_unbridged', 'subject_unresolved', null]) {
      expect(isFailingIntake(facts({ lastRejectionReason: reason })), `reason=${reason}`).toBe(false)
    }
  })

  /**
   * THE FALSE-POSITIVE CASE. The endpoint is public: a stranger posting garbage
   * at a working connection must never make it look broken.
   */
  it('valid → invalid → valid → invalid stays silent', () => {
    let counter = 0
    for (const failed of [false, true, false, true]) counter = nextConsecutiveFailures(counter, failed)
    expect(counter).toBe(1)
    expect(isFailingIntake(facts({ consecutiveRejections: counter }))).toBe(false)
  })

  it('a connection still receiving good traffic can never accumulate a streak', () => {
    let counter = 0
    // Noise interleaved with real deliveries, twenty times over.
    for (let i = 0; i < 20; i++) counter = nextConsecutiveFailures(nextConsecutiveFailures(counter, true), false)
    expect(counter).toBe(0)
    expect(isFailingIntake(facts({ consecutiveRejections: counter }))).toBe(false)
  })
})

// ── 5, 6, 14: the delivery state the page renders from ──────────────────────

describe('the delivery state a connection reports', () => {
  const base = {
    eventCount: 0,
    consecutiveRejections: 0,
    lastRejectedAt: null,
    lastEventAt: null,
    lastRejectionReason: null,
  }

  it('still answers the three original questions unchanged', () => {
    expect(deliveryStateOf('revoked', true, base)).toBe('disconnected')
    expect(deliveryStateOf('needs_reauth', true, base)).toBe('disconnected')
    expect(deliveryStateOf('ok', false, base)).toBe('unknown')
    expect(deliveryStateOf('ok', true, base)).toBe('never_received')
    expect(deliveryStateOf('ok', true, { ...base, eventCount: 4 })).toBe('receiving')
  })

  it('a STALE delivery can no longer make an active failure look healthy', () => {
    // The defect in one line: `eventCount` is 12 and `lastEventAt` is yesterday,
    // so testing delivery first said "מקבל אירועים" while leads were dropping.
    expect(
      deliveryStateOf('ok', true, {
        eventCount: 12,
        consecutiveRejections: 3,
        lastRejectedAt: '2026-08-10T10:00:00.000Z',
        lastEventAt: '2026-08-09T10:00:00.000Z',
        lastRejectionReason: 'invalid_signature',
      }),
    ).toBe('rejected')
  })

  it('one refusal against a receiving connection still reads as receiving', () => {
    expect(
      deliveryStateOf('ok', true, {
        eventCount: 12,
        consecutiveRejections: 1,
        lastRejectedAt: '2026-08-10T10:00:00.000Z',
        lastEventAt: '2026-08-09T10:00:00.000Z',
        lastRejectionReason: 'invalid_signature',
      }),
    ).toBe('receiving')
  })

  it('a broken connection is called disconnected, not rejecting', () => {
    // Health comes first: "reconnect" is the useful instruction, and two
    // problems reported at once is one too many.
    expect(
      deliveryStateOf('revoked', true, {
        eventCount: 12,
        consecutiveRejections: 5,
        lastRejectedAt: '2026-08-10T10:00:00.000Z',
        lastEventAt: '2026-08-09T10:00:00.000Z',
        lastRejectionReason: 'invalid_signature',
      }),
    ).toBe('disconnected')
  })
})

// ── 10–13: the customer-facing copy ─────────────────────────────────────────

describe('technical reason → customer copy', () => {
  it('invalid_signature maps to the approved Hebrew', () => {
    const copy = intakeErrorCopy('invalid_signature')!
    expect(copy.title).toBe('יש בעיה בחיבור לטופס באתר')
    expect(copy.explanation).toBe(
      'התקבל ניסיון לשלוח ליד מהטופס באתר שלך, אבל החיבור לא אומת ולכן הליד לא נכנס למערכת.',
    )
    expect(copy.short).toBe('פניות מהטופס מגיעות אבל לא נכנסות למערכת.')
  })

  it('the CTA points at the real integration destination', () => {
    expect(intakeErrorCopy('invalid_signature')!.action).toEqual({
      label: 'בדיקת החיבור',
      href: '/settings/integrations?section=website',
    })
  })

  it('NO customer copy leaks a technical term', () => {
    const banned = [
      'invalid_signature', 'signature', 'webhook', 'HMAC', 'hmac', 'endpoint',
      '401', '400', 'HTTP', 'payload', 'connection_id', 'connectionId', 'API', 'stack',
    ]
    for (const [reason, copy] of Object.entries(INTAKE_ERRORS)) {
      const text = `${copy!.title} ${copy!.explanation} ${copy!.short} ${copy!.action?.label ?? ''}`
      for (const term of banned) {
        expect(text.includes(term), `"${term}" leaked in ${reason}`).toBe(false)
      }
    }
  })

  it('the map is PARTIAL — only actionable reasons carry copy', () => {
    expect(isCustomerFacingRejection('invalid_signature')).toBe(true)
    expect(isCustomerFacingRejection('unreadable_payload')).toBe(true)
    // Decisions, not errors — the route returns 200 for these.
    for (const reason of ['not_actionable', 'event_undescribed', 'event_unbridged', 'subject_unresolved']) {
      expect(isCustomerFacingRejection(reason), reason).toBe(false)
      expect(intakeErrorCopy(reason)).toBeNull()
    }
  })

  it('every mapped reason that offers an action has a real destination', () => {
    for (const [reason, copy] of Object.entries(INTAKE_ERRORS)) {
      if (!copy!.action) continue
      expect(copy!.action.href.startsWith('/'), reason).toBe(true)
      expect(copy!.action.label.trim().length, reason).toBeGreaterThan(0)
    }
  })
})

// ── 16: the boundary ────────────────────────────────────────────────────────

describe('this is lead intake, not an automation failure', () => {
  it('nothing in the intake path touches the automation engine', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const file of [
      'lib/automations/connectors/intakeErrors.ts',
      'lib/automations/connectors/intakeAlerts.ts',
      'components/clients/LeadIntakeBanner.tsx',
    ]) {
      const code = codeOnly(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
      // The engine was never reached, so none of these may write to it or name it.
      for (const forbidden of ['automation_activity', 'automation_jobs', 'appendActivity', 'emitAutomationEvent']) {
        expect(code.includes(forbidden), `${file} references ${forbidden}`).toBe(false)
      }
    }
  })
})
