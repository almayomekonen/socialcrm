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
import { ACTION_TYPES, TRIGGER_TYPES } from '@/lib/automations/types'
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

  it('registers the shipped surface; every phase since has only APPENDED to it', () => {
    // Append-only in practice, not just in principle: the B1 entries are still
    // first and unchanged. A reorder or an edit here is a migration of meaning.
    expect(catalog.subjects.map((s) => s.key)).toEqual(['lead', 'appointment', 'form'])
    expect(catalog.events.map((e) => e.key)).toEqual([
      'lead.created',
      'lead.status_changed',
      'appointment.booked',
      'form.submitted',
    ])
    // `whatsapp.send` is APPENDED — the two B1 actions keep their positions, which
    // is the property this assertion exists to prove.
    expect(catalog.actions.map((a) => a.key)).toEqual(['email.send', 'task.create', 'whatsapp.send'])
  })

  it('registers integrations as data only, append-only, one row each', () => {
    // ONE row. The appointment occurrence used to need a second one, back when a
    // scheduling connector produced it; it is produced by the Meetings domain
    // now, which needs no connection.
    expect(catalog.integrations.map((i) => i.key)).toEqual(['contact_form_7'])
    // §3.1: presentation plus one auth strategy from the CLOSED set. Nothing
    // executable, nothing the Builder has to interpret.
    expect(catalog.integrations[0]).toMatchObject({ auth: 'api_key', capabilities: ['website_connected'] })
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
  it('every catalog action bridges to a persisted engine value, and vice versa', () => {
    /**
     * THE REGRESSION THIS PINS. `task.create` and `whatsapp.send` shipped
     * catalog-complete, executor-complete and law-complete while the bridge
     * still mapped only `email.send` — so createDefinition wrote an explicit
     * NULL into a NOT NULL column and NEITHER ACTION COULD BE SAVED. The
     * marketplace template `internal_task_on_new_lead` was uninstallable in
     * production as a result.
     *
     * The trigger vocabulary has had this exact assertion since B1, which is
     * why triggers were widened correctly twice and actions were not. Both
     * directions now, so a fourth action fails CI rather than failing at the
     * INSERT.
     */
    for (const action of catalog.actions) {
      const engineValue = engineActionForActionKey(action.key)
      expect(engineValue, `catalog action "${action.key}" has no engine value`).toBeTruthy()
      expect(ACTION_TYPES, `engine value "${engineValue}" is not a persisted ActionType`).toContain(engineValue)
    }
    for (const key of bridgedActionKeys()) {
      expect(getAction(key), `bridged action key "${key}" is not in the catalog`).toBeTruthy()
    }
  })

  it('the bridge is a total, round-tripping bijection', () => {
    expect(bridgedActionKeys().length).toBe(ACTION_TYPES.length)
    for (const engineValue of ACTION_TYPES) {
      expect(engineActionForActionKey(actionKeyForEngineAction(engineValue) as string)).toBe(engineValue)
    }
  })

  it('the persisted values are the ones the widened CHECK admits', () => {
    // migrations/20260809000001 admits exactly this list. The DB is the other
    // half of the contract, and a value absent there fails at the INSERT with a
    // constraint error rather than anywhere a type could catch it.
    expect([...ACTION_TYPES]).toEqual(['send_email', 'create_task', 'send_whatsapp'])
  })

  it('email.send bridges to the persisted "send_email" value', () => {
    expect(engineActionForActionKey('email.send')).toBe('send_email')
    expect(actionKeyForEngineAction('send_email')).toBe('email.send')
    // Append-only: email keeps its position, the two shipped actions follow.
    expect(bridgedActionKeys()).toEqual(['email.send', 'task.create', 'whatsapp.send'])
  })

  it('task.create and whatsapp.send bridge to their persisted values', () => {
    expect(engineActionForActionKey('task.create')).toBe('create_task')
    expect(actionKeyForEngineAction('create_task')).toBe('task.create')
    expect(engineActionForActionKey('whatsapp.send')).toBe('send_whatsapp')
    expect(actionKeyForEngineAction('send_whatsapp')).toBe('whatsapp.send')
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
    expect(params.map((p) => p.key)).toEqual(['subject', 'body', 'ctaLabel', 'ctaUrl'])
    // The shipped sheet caps the subject at 120 characters.
    expect(params.find((p) => p.key === 'subject')?.validation?.maxLength).toBe(120)
    // Content is required; the CTA block is optional, and neither half is
    // required ON ITS OWN — the pair is enforced together in manage.ts, because
    // "required" cannot express "both or neither".
    expect(params.filter((p) => p.validation?.required).map((p) => p.key)).toEqual(['subject', 'body'])
    expect(params.find((p) => p.key === 'ctaLabel')?.validation?.maxLength).toBe(40)
    // https only — an email button is not a place to downgrade the scheme.
    const urlPattern = params.find((p) => p.key === 'ctaUrl')?.validation?.pattern
    expect(urlPattern).toBeDefined()
    expect(new RegExp(urlPattern!).test('https://example.co.il/book')).toBe(true)
    expect(new RegExp(urlPattern!).test('http://example.co.il/book')).toBe(false)
  })
})

describe('CONFORMANCE — declared laws match the laws decideSend enforces', () => {
  const NOW = new Date('2026-08-03T09:00:00Z')
  const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
    event: { trigger: 'lead_created', origin: 'manual', agencyId: 1, leadId: 1, occurredAt: NOW },
    lead: { exists: true, currentStatus: 'new' },
    recipients: { email: { value: 'a@b.co', blocked: false } },
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
      'reason' in
      decideSend(
        facts({ lead: { exists: true, currentStatus: 'new' }, recipients: { email: { value: 'a@b.co', blocked: true } } }),
      )
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
  /**
   * The variable set is PARTITIONED, not uniform. Lead-scoped variables appear
   * on every event; appointment-scoped ones appear only where a meeting exists
   * to resolve them. So the invariant is no longer "these three labels in this
   * order" — it is that every token the renderer offers is backed by a real
   * catalog field, with the same label, on some event.
   *
   * That is what keeps a chip from ever rendering as a raw `{{token}}`: the
   * Builder derives chips by intersecting the SELECTED event's fields with what
   * the renderer can resolve, so a token with no field behind it is simply never
   * offered.
   */
  it('every renderer variable token is backed by a catalog field with the same label', () => {
    for (const variable of AUTOMATION_EMAIL_VARIABLES) {
      const match = catalog.events.flatMap((e) => e.fields).find((f) => f.key === variable.field)
      expect(match, `token "${variable.token}" has no catalog field "${variable.field}"`).toBeDefined()
      expect(match?.label, `field "${variable.field}" label drifted from its token`).toBe(variable.token)
    }
  })

  it('the lead-scoped renderable fields keep their labels and order', () => {
    const created = getEvent('lead.created')
    const labels = RENDERABLE_FIELD_KEYS.map((k) => created?.fields.find((f) => f.key === k)?.label)
    expect(labels).toEqual(['שם הליד', 'שם העסק', 'שם הנציג'])
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
  it('email.send is offered for every event that exposes an email field', () => {
    for (const key of ['lead.created', 'lead.status_changed']) {
      expect(
        listActionsForEvent(getEvent(key)!).map((a) => a.key),
        key,
      ).toContain('email.send')
    }
  })

  it('neither shipped event offers a timing anchor — no datetime field exists yet', () => {
    // This is exactly why ADR-007 excluded anchors from V1: nothing to anchor to.
    for (const key of ['lead.created', 'lead.status_changed']) {
      expect(listAnchorFields(getEvent(key)!), key).toEqual([])
    }
  })

  it('every registered event is selectable (none is deprecated)', () => {
    expect(listSelectableEvents().map((e) => e.key)).toEqual([
      'lead.created',
      'lead.status_changed',
      'appointment.booked',
      'form.submitted',
    ])
  })
})
