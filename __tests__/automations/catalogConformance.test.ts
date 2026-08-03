import { describe, expect, it } from 'vitest'
import {
  catalog,
  getAction,
  getEvent,
  listActionsForEvent,
  listAnchorFields,
  listSelectableEvents,
} from '@/lib/automations/catalog/registry'
import { validateCatalog } from '@/lib/automations/catalog/validate'
import {
  actionKeyForEngineAction,
  bridgedActionKeys,
  bridgedEventKeys,
  engineActionForActionKey,
  engineTriggerForEventKey,
  eventKeyForEngineTrigger,
} from '@/lib/automations/catalog/engineBridge'
import { RENDERABLE_FIELD_KEYS } from '@/lib/automations/catalog/entries/events'
import { TRIGGER_TYPES } from '@/lib/automations/types'
import { AUTOMATION_EMAIL_VARIABLES } from '@/lib/automations/variables'
import { DEFAULT_AGENCY_DAILY_CEILING, DEFAULT_LEAD_DAILY_CAP, decideSendForAction, type SendFacts } from '@/lib/automations/laws'

/**
 * B1 PROOF: the catalog describes the SHIPPED engine, and the two cannot drift.
 *
 * The engine does not yet READ the catalog at runtime — that is B2 (laws) and
 * B3 (Builder). What B1 guarantees is stronger than a comment and weaker than
 * runtime derivation: every place the engine hardcodes a definition, this suite
 * asserts the catalog says exactly the same thing. If either side changes
 * alone, CI fails.
 *
 * Why pinned rather than derived: deriving `TRIGGER_TYPES` or the variable set
 * from catalog data at runtime would erase the literal union types that the
 * worker, the actions layer and the renderer depend on for type safety, and
 * B1's gate is byte-identical behaviour. Pinning buys the guarantee at zero
 * behavioural risk.
 */

/**
 * B5 deleted the `decideSend` email adapter. These assertions are unchanged —
 * they now run through the GENERIC path, asking about the `email.send` action
 * explicitly. That the whole suite still passes verbatim is the proof that
 * routing email through the executor changed no law outcome.
 */
const decideSend = (f: SendFacts) => decideSendForAction(getAction('email.send')!, f)

describe('the B1 catalog is valid', () => {
  it('passes whole-catalog validation', () => {
    expect(validateCatalog(catalog)).toEqual([])
  })

  it('registers the shipped surface, and B7 appended to it without disturbing it', () => {
    // Append-only in practice, not just in principle: the B1 entries are still
    // first and unchanged. A reorder or an edit here is a migration of meaning.
    expect(catalog.subjects.map((s) => s.key)).toEqual(['lead', 'appointment'])
    expect(catalog.events.map((e) => e.key)).toEqual(['lead.created', 'lead.status_changed', 'appointment.booked'])
    expect(catalog.actions.map((a) => a.key)).toEqual(['email.send'])
  })

  it('registers the first integration — and only as data', () => {
    expect(catalog.integrations.map((i) => i.key)).toEqual(['calendly'])
    // §3.1: presentation plus one auth strategy from the closed set. Nothing
    // executable, nothing the Builder has to interpret.
    expect(catalog.integrations[0]).toMatchObject({ auth: 'oauth2', capabilities: ['calendar_connected'] })
  })
})

describe('CONFORMANCE — trigger vocabulary matches the engine exactly', () => {
  it('every engine trigger has a catalog event, and vice versa', () => {
    for (const trigger of TRIGGER_TYPES) {
      const key = eventKeyForEngineTrigger(trigger)
      expect(key, `engine trigger "${trigger}" has no catalog event`).toBeTruthy()
      expect(getEvent(key as string), `catalog event "${key}" is not registered`).toBeTruthy()
    }
    for (const key of bridgedEventKeys()) {
      const trigger = engineTriggerForEventKey(key)
      expect(TRIGGER_TYPES).toContain(trigger)
    }
  })

  it('the bridge is a total, round-tripping bijection', () => {
    expect(bridgedEventKeys().length).toBe(TRIGGER_TYPES.length)
    for (const trigger of TRIGGER_TYPES) {
      expect(engineTriggerForEventKey(eventKeyForEngineTrigger(trigger) as string)).toBe(trigger)
    }
  })

  it('unknown keys resolve to null rather than guessing (Law 3)', () => {
    // B1 used `appointment.booked` as the unknown-key example. B7 registered
    // it, which is the point of an append-only vocabulary — so the example
    // moved to a key nothing has claimed.
    expect(engineTriggerForEventKey('payment.received')).toBeNull()
    expect(eventKeyForEngineTrigger('nonsense')).toBeNull()
    expect(engineActionForActionKey('sms.send')).toBeNull()
    expect(actionKeyForEngineAction('send_sms')).toBeNull()
  })
})

describe('CONFORMANCE — action vocabulary matches the engine exactly', () => {
  it('email.send bridges to the persisted "send_email" value', () => {
    expect(engineActionForActionKey('email.send')).toBe('send_email')
    expect(actionKeyForEngineAction('send_email')).toBe('email.send')
    expect(bridgedActionKeys()).toEqual(['email.send'])
  })

  it('declares the email requirement the engine enforces via the no_email skip', () => {
    expect(getAction('email.send')?.requires).toEqual(['email'])
  })

  it('declares the preview shape the renderer actually produces', () => {
    // renderAutomationEmail returns {subject, html, text} — an email shape.
    expect(getAction('email.send')?.preview).toBe('email')
    expect(getAction('email.send')?.testable).toBe(true)
    expect(getAction('email.send')?.risk).toBe('external')
  })

  it('parameter declarations match the Builder inputs in production', () => {
    const params = getAction('email.send')?.parameters ?? []
    expect(params.map((p) => p.key)).toEqual(['subject', 'body'])
    // The shipped sheet caps the subject at 120 characters.
    expect(params.find((p) => p.key === 'subject')?.validation?.maxLength).toBe(120)
    expect(params.every((p) => p.validation?.required)).toBe(true)
  })
})

describe('CONFORMANCE — declared laws match the laws decideSend enforces', () => {
  const NOW = new Date('2026-08-03T09:00:00Z')
  const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
    event: { trigger: 'lead_created', origin: 'manual', agencyId: 1, leadId: 1, occurredAt: NOW },
    lead: { exists: true, email: 'a@b.co', currentStatus: 'new', emailUndeliverable: false },
    suppressed: false,
    alreadySent: false,
    sentToLeadToday: 0,
    sentByAgencyToday: 0,
    now: NOW,
    ...over,
  })

  /** Each declared law must be demonstrably enforced by the engine today. */
  const enforcement: Record<string, () => string | undefined> = {
    send_once: () => ('reason' in decideSend(facts({ alreadySent: true })) ? 'already_sent' : undefined),
    per_lead_cap: () =>
      'reason' in decideSend(facts({ sentToLeadToday: DEFAULT_LEAD_DAILY_CAP })) ? 'lead_daily_cap' : undefined,
    agency_cap: () =>
      'reason' in decideSend(facts({ sentByAgencyToday: DEFAULT_AGENCY_DAILY_CEILING })) ? 'agency_daily_cap' : undefined,
    suppression: () => ('reason' in decideSend(facts({ suppressed: true })) ? 'suppressed' : undefined),
    bounce_block: () =>
      'reason' in decideSend(facts({ lead: { exists: true, email: 'a@b.co', currentStatus: 'new', emailUndeliverable: true } }))
        ? 'address_undeliverable'
        : undefined,
    quiet_hours: () => ('reason' in decideSend(facts({ quietHours: { startHour: 0, endHour: 23 } })) ? 'quiet_hours' : undefined),
  }

  it('every law declared on email.send is actually enforced', () => {
    const declared = getAction('email.send')?.laws ?? []
    expect(declared.length).toBeGreaterThan(0)
    for (const law of declared) {
      const check = enforcement[law]
      expect(check, `law "${law}" is declared but has no enforcement proof`).toBeTruthy()
      expect(check?.(), `law "${law}" is declared but decideSend did not enforce it`).toBeTruthy()
    }
  })

  it('declares exactly the six per-action laws, and no engine-universal guards', () => {
    expect([...(getAction('email.send')?.laws ?? [])].sort()).toEqual(
      ['agency_cap', 'bounce_block', 'per_lead_cap', 'quiet_hours', 'send_once', 'suppression'].sort(),
    )
  })

  it('a clean fact set still passes — the declaration does not over-block', () => {
    expect(decideSend(facts())).toEqual({ allow: true })
  })
})

describe('CONFORMANCE — the closed variable set matches the catalog fields', () => {
  it('renderable fields are exactly the renderer variable tokens, in order', () => {
    const created = getEvent('lead.created')
    const labels = RENDERABLE_FIELD_KEYS.map((k) => created?.fields.find((f) => f.key === k)?.label)
    expect(labels).toEqual(AUTOMATION_EMAIL_VARIABLES.map((v) => v.token))
  })

  it('both events expose the same renderable fields — variables do not vary by trigger', () => {
    for (const key of ['lead.created', 'lead.status_changed']) {
      const fields = getEvent(key)?.fields.map((f) => f.key) ?? []
      for (const renderable of RENDERABLE_FIELD_KEYS) expect(fields, key).toContain(renderable)
    }
  })

  it('every renderable field is live — the renderer resolves them at send time', () => {
    const created = getEvent('lead.created')
    for (const k of RENDERABLE_FIELD_KEYS) {
      expect(created?.fields.find((f) => f.key === k)?.freshness, k).toBe('live')
    }
  })
})

describe('derived capabilities behave on real entries', () => {
  it('email.send is offered for both events (both expose an email field)', () => {
    for (const key of ['lead.created', 'lead.status_changed']) {
      expect(
        listActionsForEvent(getEvent(key)!).map((a) => a.key),
        key,
      ).toEqual(['email.send'])
    }
  })

  it('neither shipped event offers a timing anchor — no datetime field exists yet', () => {
    // This is exactly why ADR-007 excluded anchors from V1: nothing to anchor to.
    for (const key of ['lead.created', 'lead.status_changed']) {
      expect(listAnchorFields(getEvent(key)!), key).toEqual([])
    }
  })

  it('every registered event is selectable (none is deprecated)', () => {
    expect(listSelectableEvents().map((e) => e.key)).toEqual(['lead.created', 'lead.status_changed', 'appointment.booked'])
  })
})
