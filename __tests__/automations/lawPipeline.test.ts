import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENCY_DAILY_CEILING,
  DEFAULT_LEAD_DAILY_CAP,
  composeLawPipeline,
  decideSendForAction,
  type SendFacts,
} from '@/lib/automations/laws'
import { catalog, getAction } from '@/lib/automations/catalog/registry'
import { LAW_KEYS } from '@/lib/automations/catalog/vocabularies'

/**
 * B2 — the law pipeline is composed from catalog declarations.
 *
 * Two things must hold simultaneously: the shipped email path behaves exactly
 * as it did before (byte-identical gate), AND an action with a different law
 * set genuinely gets a different pipeline — which is the whole point of §3.8
 * and the correctness fix for `task.create`.
 */

const NOW = new Date('2026-08-03T09:00:00Z')

const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
  event: { trigger: 'lead_created', origin: 'manual', agencyId: 7, leadId: 42, occurredAt: NOW },
  lead: { exists: true, currentStatus: 'new' },
  recipients: { email: { value: 'dana@example.com', blocked: false } },
  suppressed: false,
  alreadySent: false,
  sentToLeadToday: 0,
  sentByAgencyToday: 0,
  now: NOW,
  ...over,
})

const reasonOf = (d: ReturnType<typeof decideSend>) => ('reason' in d ? d.reason : null)

/**
 * B5 deleted the `decideSend` email adapter. These assertions are unchanged —
 * they now run through the GENERIC path, asking about the `email.send` action
 * explicitly. That the whole suite still passes verbatim is the proof that
 * routing email through the executor changed no law outcome.
 */
const decideSend = (f: SendFacts) => decideSendForAction(getAction('email.send')!, f)

describe('BYTE-IDENTICAL — the shipped email path is unchanged', () => {
  it('allows a clean send', () => {
    expect(decideSend(facts())).toEqual({ allow: true })
  })

  // Exactly the pre-B2 order and reasons, in sequence.
  it.each([
    ['origin_import', facts({ event: { trigger: 'lead_created', origin: 'import', agencyId: 7, leadId: 42, occurredAt: NOW } })],
    [
      'lead_deleted',
      facts({ lead: { exists: false, currentStatus: null }, recipients: { email: { value: null, blocked: false } } }),
    ],
    [
      'premise_expired',
      facts({ lead: { exists: true, currentStatus: 'closed' }, recipients: { email: { value: 'a@b.co', blocked: false } } }),
    ],
    ['suppressed', facts({ suppressed: true })],
    ['no_email', facts({ lead: { exists: true, currentStatus: 'new' }, recipients: { email: { value: null, blocked: false } } })],
    [
      'address_undeliverable',
      facts({ lead: { exists: true, currentStatus: 'new' }, recipients: { email: { value: 'a@b.co', blocked: true } } }),
    ],
    ['already_sent', facts({ alreadySent: true })],
    ['lead_daily_cap', facts({ sentToLeadToday: DEFAULT_LEAD_DAILY_CAP })],
    ['agency_daily_cap', facts({ sentByAgencyToday: DEFAULT_AGENCY_DAILY_CEILING })],
    ['quiet_hours', facts({ quietHours: { startHour: 0, endHour: 23 } })],
  ])('still skips with "%s"', (expected, f) => {
    expect(reasonOf(decideSend(f))).toBe(expected)
  })

  it('preserves precedence when several laws apply at once', () => {
    // Universal guards outrank every declared law.
    expect(
      reasonOf(
        decideSend(
          facts({
            event: { trigger: 'lead_created', origin: 'import', agencyId: 7, leadId: 42, occurredAt: NOW },
            suppressed: true,
            alreadySent: true,
          }),
        ),
      ),
    ).toBe('origin_import')
    // Suppression outranks missing recipient, which outranks dedup.
    expect(
      reasonOf(
        decideSend(
          facts({
            suppressed: true,
            lead: { exists: true, currentStatus: 'new' },
            recipients: { email: { value: null, blocked: false } },
          }),
        ),
      ),
    ).toBe('suppressed')
    expect(reasonOf(decideSend(facts({ alreadySent: true, sentToLeadToday: 99 })))).toBe('already_sent')
  })
})

describe('the pipeline is genuinely composed from declarations', () => {
  it('email.send sources its laws from the catalog, not a hardcoded list', () => {
    const action = getAction('email.send')!
    expect(decideSendForAction(action, facts({ suppressed: true }))).toEqual({ allow: false, reason: 'suppressed' })
  })

  it('an internal-style action (send_once only) IGNORES suppression, caps and quiet hours', () => {
    // This is the §3.8 correctness fix: a suppressed lead must still get a
    // task created for the rep. Not yet a registered action — B5 registers it.
    const internal = { laws: ['send_once'] as const, requires: [] as const }
    expect(decideSendForAction(internal, facts({ suppressed: true }))).toEqual({ allow: true })
    expect(decideSendForAction(internal, facts({ sentToLeadToday: 99 }))).toEqual({ allow: true })
    expect(decideSendForAction(internal, facts({ sentByAgencyToday: 99999 }))).toEqual({ allow: true })
    expect(decideSendForAction(internal, facts({ quietHours: { startHour: 0, endHour: 23 } }))).toEqual({ allow: true })
    // ...but send-once still applies.
    expect(reasonOf(decideSendForAction(internal, facts({ alreadySent: true })))).toBe('already_sent')
  })

  it('an action requiring no recipient does not demand an email', () => {
    const internal = { laws: ['send_once'] as const, requires: [] as const }
    const noEmail = facts({
      lead: { exists: true, currentStatus: 'new' },
      recipients: { email: { value: null, blocked: false } },
    })
    expect(decideSendForAction(internal, noEmail)).toEqual({ allow: true })
  })

  it('universal guards still apply to every action, however few laws it declares', () => {
    const internal = { laws: ['send_once'] as const, requires: [] as const }
    expect(
      reasonOf(
        decideSendForAction(
          internal,
          facts({ lead: { exists: false, currentStatus: null }, recipients: { email: { value: null, blocked: false } } }),
        ),
      ),
    ).toBe('lead_deleted')
    expect(
      reasonOf(
        decideSendForAction(
          internal,
          facts({ event: { trigger: 'lead_created', origin: 'import', agencyId: 7, leadId: 42, occurredAt: NOW } }),
        ),
      ),
    ).toBe('origin_import')
  })
})

describe('composeLawPipeline', () => {
  it('orders steps canonically regardless of declaration order', () => {
    const a = composeLawPipeline(['quiet_hours', 'suppression', 'send_once'], [])
    const b = composeLawPipeline(['send_once', 'quiet_hours', 'suppression'], [])
    expect(a.steps.length).toBe(b.steps.length)
    // Suppression first in both: the first failing step must be identical.
    const suppressed = facts({ suppressed: true, quietHours: { startHour: 0, endHour: 23 }, alreadySent: true })
    expect(a.steps[0](suppressed)).toBe('suppressed')
    expect(b.steps[0](suppressed)).toBe('suppressed')
  })

  it('inserts the recipient check between suppression and bounce_block', () => {
    const { steps } = composeLawPipeline(['suppression', 'bounce_block'], ['email'])
    expect(steps).toHaveLength(3)
    expect(steps[0](facts({ suppressed: true }))).toBe('suppressed')
    expect(
      steps[1](facts({ lead: { exists: true, currentStatus: 'new' }, recipients: { email: { value: null, blocked: false } } })),
    ).toBe('no_email')
    expect(
      steps[2](
        facts({ lead: { exists: true, currentStatus: 'new' }, recipients: { email: { value: 'a@b.co', blocked: true } } }),
      ),
    ).toBe('address_undeliverable')
  })

  it('reports declared-but-unimplemented laws instead of silently passing them', () => {
    // `window_24h` is the remaining unimplemented law — deliberately so: the
    // shipped messaging action is template-only, and an approved template
    // delivers whether or not the 24-hour window is open, so there is nothing for
    // it to gate until a free-text action exists. `opt_out` used to stand here
    // and now ships, which is why this reads window_24h instead.
    const { unimplemented } = composeLawPipeline(['send_once', 'window_24h'], [])
    expect(unimplemented).toEqual(['window_24h'])
  })
})

describe('FAIL CLOSED — an unevaluatable pipeline never becomes a silent send', () => {
  it('an action declaring an unimplemented law is refused, not allowed', () => {
    const future = { laws: ['send_once', 'window_24h'] as const, requires: [] as const }
    expect(decideSendForAction(future, facts())).toEqual({ allow: false, reason: 'action_unavailable' })
  })

  it('CI guarantee: no REGISTERED action declares an unimplemented law', () => {
    for (const action of catalog.actions) {
      const { unimplemented } = composeLawPipeline(action.laws, action.requires)
      expect(unimplemented, `${action.key} declares unimplemented laws`).toEqual([])
    }
  })

  it('CI guarantee: every recipient type a registered action requires has a check', () => {
    for (const action of catalog.actions) {
      const { steps } = composeLawPipeline(action.laws, action.requires)
      // requires-derived steps must materialise; email.send must gain one.
      if (action.requires.length > 0) {
        expect(steps.length, `${action.key} requires ${action.requires} but got no recipient check`).toBeGreaterThan(
          action.laws.length,
        )
      }
    }
  })

  it('every law in the vocabulary is either implemented or explicitly future', () => {
    // Exhaustiveness is enforced by Record<LawKey, …> at compile time; this
    // asserts the runtime split is the one we intend.
    const implemented = LAW_KEYS.filter((k) => composeLawPipeline([k], []).unimplemented.length === 0)
    expect([...implemented].sort()).toEqual(
      ['agency_cap', 'bounce_block', 'opt_out', 'per_lead_cap', 'quiet_hours', 'send_once', 'suppression'].sort(),
    )
    // The intended split, stated positively: exactly one law remains future, and
    // it is the one no shipped action can trip.
    const future = LAW_KEYS.filter((k) => composeLawPipeline([k], []).unimplemented.length > 0)
    expect(future).toEqual(['window_24h'])
  })
})
