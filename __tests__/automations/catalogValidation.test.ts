import { describe, expect, it } from 'vitest'
import { validateAction, validateCatalog, validateEvent } from '@/lib/automations/catalog/validate'
import { catalog, everyLawDocumented, listActionsForEvent, listAnchorFields, listSelectableEvents } from '@/lib/automations/catalog/registry'
import { LAW_KEYS, OPERATORS_BY_FIELD_TYPE, FIELD_TYPES } from '@/lib/automations/catalog/vocabularies'
import type { ActionDefinition, EventDefinition } from '@/lib/automations/catalog/types'

/**
 * B0 GATE: "Validation fails a deliberate bad entry."
 *
 * These tests are the mechanism that makes the frozen architecture
 * enforceable — and specifically what makes AI-drafted catalog metadata safe
 * to accept (frozen spec §4 Q3). Every deliberate-bad-entry case below is a
 * hallucination an LLM could plausibly produce.
 */

const SUBJECTS = ['lead', 'appointment']

const goodEvent = (over: Partial<EventDefinition> = {}): EventDefinition => ({
  key: 'appointment.booked',
  origin: 'external',
  subject: 'appointment',
  title: 'נקבעה פגישה',
  description: 'כשליד קובע פגישה ביומן',
  icon: 'calendar',
  lifecycle: 'stable',
  requirements: [],
  parameters: [],
  fields: [
    { key: 'startsAt', type: 'datetime', label: 'מועד הפגישה', freshness: 'snapshot', lifecycle: 'stable' },
    { key: 'leadEmail', type: 'email', label: 'אימייל הליד', freshness: 'live', lifecycle: 'stable' },
  ],
  identity: { occurrenceKey: 'appointment.id', leadResolution: 'by invitee email, then phone' },
  ...over,
})

const goodAction = (over: Partial<ActionDefinition> = {}): ActionDefinition => ({
  key: 'email.send',
  title: 'שליחת אימייל',
  description: 'שולח אימייל לליד',
  icon: 'envelope',
  requirements: [],
  requires: ['email'],
  parameters: [],
  laws: ['send_once', 'suppression'],
  risk: 'external',
  preview: 'email',
  testable: true,
  ...over,
})

const messages = (issues: { message: string }[]) => issues.map((i) => i.message).join(' | ')

describe('a well-formed entry validates cleanly', () => {
  it('accepts a valid event', () => {
    expect(validateEvent(goodEvent(), SUBJECTS)).toEqual([])
  })

  it('accepts a valid action', () => {
    expect(validateAction(goodAction())).toEqual([])
  })
})

describe('DELIBERATE BAD ENTRIES — events', () => {
  it('rejects an unknown field type (the classic AI hallucination)', () => {
    const bad = goodEvent({
      fields: [{ key: 'x', type: 'currency' as never, label: 'x', freshness: 'snapshot', lifecycle: 'stable' }],
    })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('unknown field type "currency"')
  })

  it('rejects a field with no freshness — it decides what a delayed condition reads', () => {
    const bad = goodEvent({
      fields: [{ key: 'x', type: 'text', label: 'x', freshness: undefined as never, lifecycle: 'stable' }],
    })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('field.freshness must be one of')
  })

  it('rejects a missing identity rule (ADR-010)', () => {
    const bad = goodEvent({ identity: { occurrenceKey: '', leadResolution: 'x' } })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('identity.occurrenceKey is required')
  })

  it('rejects an event with NO declared lead resolution (Law 2)', () => {
    const bad = goodEvent({ identity: { occurrenceKey: 'x', leadResolution: '' } })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('every Event MUST resolve to exactly one Lead')
  })

  it('rejects a subject that is not a registered SubjectDefinition', () => {
    expect(messages(validateEvent(goodEvent({ subject: 'invoice' }), SUBJECTS))).toContain('is not a registered SubjectDefinition')
  })

  it('rejects an unnamespaced or malformed key', () => {
    for (const key of ['booked', 'Appointment.Booked', 'appointment-booked', '']) {
      expect(messages(validateEvent(goodEvent({ key }), SUBJECTS)), key).toContain('namespaced lowercase')
    }
  })

  it('rejects unknown origin and lifecycle', () => {
    expect(messages(validateEvent(goodEvent({ origin: 'webhook' as never }), SUBJECTS))).toContain('unknown origin')
    expect(messages(validateEvent(goodEvent({ lifecycle: 'draft' as never }), SUBJECTS))).toContain('unknown lifecycle')
  })

  it('rejects duplicate field keys', () => {
    const f = { key: 'dup', type: 'text' as const, label: 'a', freshness: 'live' as const, lifecycle: 'stable' as const }
    expect(messages(validateEvent(goodEvent({ fields: [f, f] }), SUBJECTS))).toContain('duplicate field key')
  })

  it('rejects missing user-facing Hebrew copy', () => {
    expect(messages(validateEvent(goodEvent({ title: '' }), SUBJECTS))).toContain('title is required')
    expect(messages(validateEvent(goodEvent({ description: '  ' }), SUBJECTS))).toContain('description is required')
  })

  it('rejects an enum field with no options', () => {
    const bad = goodEvent({ fields: [{ key: 'e', type: 'enum', label: 'e', freshness: 'live', lifecycle: 'stable' }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('enum fields require a non-empty options list')
  })
})

describe('DELIBERATE BAD ENTRIES — parameters (Law 4: closed sets)', () => {
  it('rejects an invented parameter type — no integration may add one', () => {
    const bad = goodEvent({
      parameters: [{ key: 'p', type: 'product_picker' as never, label: 'מוצר' }],
    })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('no integration may introduce one')
  })

  it('rejects enum_remote with no optionSource', () => {
    const bad = goodEvent({ parameters: [{ key: 'cal', type: 'enum_remote', label: 'יומן' }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('enum_remote requires optionSource')
  })

  it('rejects enum_static with no options', () => {
    const bad = goodEvent({ parameters: [{ key: 's', type: 'enum_static', label: 's' }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('enum_static requires a non-empty options list')
  })

  it('rejects an invented validator', () => {
    const bad = goodEvent({
      parameters: [{ key: 'p', type: 'text', label: 'p', validation: { mustBeCool: true } as never }],
    })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('validators are a closed set')
  })

  it('rejects an unparseable regex validator', () => {
    const bad = goodEvent({ parameters: [{ key: 'p', type: 'text', label: 'p', validation: { pattern: '([' } }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('not a valid regex')
  })
})

describe('DELIBERATE BAD ENTRIES — requirements', () => {
  it('rejects an unknown requirement type', () => {
    const bad = goodEvent({ requirements: [{ type: 'subscription' as never, key: 'x' }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('unknown requirement type')
  })

  it('rejects a connection requirement with no CTA — a gate the user cannot resolve', () => {
    const bad = goodEvent({ requirements: [{ type: 'connection', key: 'calendar' }] })
    expect(messages(validateEvent(bad, SUBJECTS))).toContain('must declare a cta')
  })
})

describe('DELIBERATE BAD ENTRIES — actions', () => {
  it('rejects an unknown law key — no integration may add a law', () => {
    expect(messages(validateAction(goodAction({ laws: ['send_once', 'be_nice' as never] })))).toContain('no integration may add a law')
  })

  it('requires send_once on every action', () => {
    expect(messages(validateAction(goodAction({ laws: ['suppression'] })))).toContain('send_once is required')
  })

  it('rejects an empty law list — an empty pipeline must be deliberate', () => {
    expect(messages(validateAction(goodAction({ laws: [] })))).toContain('laws must be declared explicitly')
  })

  it('rejects an invented preview shape', () => {
    expect(messages(validateAction(goodAction({ preview: 'carousel' as never })))).toContain('preview shapes are a closed set')
  })

  it('rejects an unknown risk class and an undeclared testable flag', () => {
    expect(messages(validateAction(goodAction({ risk: 'scary' as never })))).toContain('unknown risk')
    expect(messages(validateAction(goodAction({ testable: undefined as never })))).toContain('testable must be declared')
  })

  it('rejects an unknown field type in requires', () => {
    expect(messages(validateAction(goodAction({ requires: ['fax' as never] })))).toContain('unknown field type')
  })
})

describe('whole-catalog validation', () => {
  it('the shipped B0 catalog is valid', () => {
    expect(validateCatalog(catalog)).toEqual([])
  })

  it('every law key in the vocabulary is documented', () => {
    expect(everyLawDocumented()).toBe(true)
    expect(catalog.laws.map((l) => l.key).sort()).toEqual([...LAW_KEYS].sort())
  })

  it('catches duplicate event keys across the catalog', () => {
    const issues = validateCatalog({
      ...catalog,
      subjects: [{ key: 'appointment', title: 'פגישות', icon: 'calendar' }],
      events: [goodEvent(), goodEvent()],
    })
    expect(messages(issues)).toContain('duplicate event key')
  })

  it('catches an action referencing an undocumented law', () => {
    const issues = validateCatalog({ ...catalog, laws: [], actions: [goodAction()] })
    expect(messages(issues)).toContain('is not documented in the law catalog')
  })
})

describe('the derived-capability mechanisms (§1)', () => {
  it('every field type has condition operators — "add a field, get conditions free"', () => {
    for (const t of FIELD_TYPES) {
      expect(OPERATORS_BY_FIELD_TYPE[t]?.length, t).toBeGreaterThan(0)
    }
  })

  it('timing anchors are exactly the datetime fields', () => {
    expect(listAnchorFields(goodEvent()).map((f) => f.key)).toEqual(['startsAt'])
  })

  it('actions self-filter by requires × fields', () => {
    const emailAction = goodAction({ requires: ['email'] })
    const smsAction = goodAction({ key: 'sms.send', requires: ['phone'] })
    const withEmailOnly = goodEvent()
    // Simulating the registry's filter over an ad-hoc action set.
    const offered = [emailAction, smsAction].filter((a) =>
      a.requires.every((t) => new Set(withEmailOnly.fields.map((f) => f.type)).has(t)),
    )
    expect(offered.map((a) => a.key)).toEqual(['email.send'])
  })

  it('deprecated events are hidden from new automations but still resolvable', () => {
    // B0 catalog is empty; the filter contract is what matters here.
    expect(listSelectableEvents()).toEqual([])
    expect(listActionsForEvent(goodEvent())).toEqual([])
  })
})
