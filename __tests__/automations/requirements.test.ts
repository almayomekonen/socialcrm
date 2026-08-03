import { describe, expect, it } from 'vitest'
import { evaluateEvent, evaluateEvents, isSelectable, type RequirementContext } from '@/lib/automations/requirements'
import { listSelectableEvents } from '@/lib/automations/catalog/registry'
import type { EventDefinition, Requirement } from '@/lib/automations/catalog/types'
import { needsConnection, sourceIdsFrom } from '@/lib/automations/binding'

/**
 * B4 Part B — the Requirement Runtime.
 *
 * Frozen spec §3.4/§4 Q5: three requirement types, three experiences. The rule
 * that governs all of them is "no silent failures" — an event the agency
 * cannot actually run must never look runnable.
 */

const ctx = (over: Partial<RequirementContext> = {}): RequirementContext => ({
  capabilities: new Set<string>(),
  entitlements: new Set<string>(),
  flags: new Set<string>(),
  ...over,
})

const event = (over: Partial<EventDefinition> = {}): EventDefinition =>
  ({
    key: 'x.happened',
    subject: 'lead',
    title: 'קרה משהו',
    description: '',
    icon: 'bolt',
    lifecycle: 'stable',
    requirements: [],
    parameters: [],
    fields: [],
    identity: { occurrenceKey: 'x', leadResolution: 'x' },
    ...over,
  }) as EventDefinition

const CONNECTION: Requirement = {
  type: 'connection',
  key: 'some_capability',
  cta: { label: 'חיבור', href: '/settings/x' },
}

describe('requirement evaluation', () => {
  it('an event with no requirements is available', () => {
    expect(evaluateEvent(event(), ctx())).toEqual({ state: 'available' })
  })

  it('an unmet connection requirement LOCKS the event and carries its CTA', () => {
    const result = evaluateEvent(event({ requirements: [CONNECTION] }), ctx())
    expect(result).toEqual({ state: 'locked', requirement: CONNECTION })
    // The CTA comes from the catalog — the Builder never authors one.
    expect(result.state === 'locked' && result.requirement.cta?.href).toBe('/settings/x')
  })

  it('a met connection requirement unlocks the event', () => {
    const met = ctx({ capabilities: new Set(['some_capability']) })
    expect(evaluateEvent(event({ requirements: [CONNECTION] }), met)).toEqual({ state: 'available' })
  })

  it('an unmet entitlement locks; a met one does not', () => {
    const req: Requirement = { type: 'entitlement', key: 'pro' }
    expect(evaluateEvent(event({ requirements: [req] }), ctx()).state).toBe('locked')
    expect(evaluateEvent(event({ requirements: [req] }), ctx({ entitlements: new Set(['pro']) })).state).toBe('available')
  })

  it('an unmet FLAG hides the event entirely — an unreleased thing is not advertised', () => {
    const req: Requirement = { type: 'flag', key: 'unreleased' }
    expect(evaluateEvent(event({ requirements: [req] }), ctx()).state).toBe('hidden')
    expect(evaluateEvent(event({ requirements: [req] }), ctx({ flags: new Set(['unreleased']) })).state).toBe('available')
  })

  it('a flag outranks a connection — a hidden event never asks the user to connect anything', () => {
    const e = event({ requirements: [CONNECTION, { type: 'flag', key: 'unreleased' }] })
    expect(evaluateEvent(e, ctx()).state).toBe('hidden')
  })

  it('a deprecated event is never offered for new automations', () => {
    expect(evaluateEvent(event({ lifecycle: 'deprecated' }), ctx()).state).toBe('deprecated')
    expect(isSelectable({ state: 'deprecated' })).toBe(false)
  })

  it('only "available" is selectable — locked and deprecated are not', () => {
    expect(isSelectable({ state: 'available' })).toBe(true)
    expect(isSelectable({ state: 'locked', requirement: CONNECTION })).toBe(false)
  })
})

describe('evaluateEvents', () => {
  it('drops hidden events and keeps locked ones visible', () => {
    const events = [
      event({ key: 'a' }),
      event({ key: 'b', requirements: [CONNECTION] }),
      event({ key: 'c', requirements: [{ type: 'flag', key: 'off' }] }),
    ]
    const out = evaluateEvents(events, ctx())
    expect(out.map((e) => e.event.key)).toEqual(['a', 'b'])
    expect(out[1].availability.state).toBe('locked')
  })

  it('preserves catalog order so the picker never reshuffles under the user', () => {
    const events = [event({ key: 'a' }), event({ key: 'b' }), event({ key: 'c' })]
    expect(evaluateEvents(events, ctx()).map((e) => e.event.key)).toEqual(['a', 'b', 'c'])
  })
})

describe('the shipped catalog under an empty context', () => {
  it('every INTERNAL event stays available — no requirement was ever added to one', () => {
    const internal = listSelectableEvents().filter((e) => e.origin === 'internal')
    const out = evaluateEvents(internal, ctx())
    expect(out.length).toBe(internal.length)
    expect(out.every((e) => e.availability.state === 'available')).toBe(true)
  })

  it('every EXTERNAL event is LOCKED until its connection exists — B7, entirely from catalog data', () => {
    const external = listSelectableEvents().filter((e) => e.origin === 'external')
    expect(external.length).toBeGreaterThan(0)
    for (const e of evaluateEvents(external, ctx())) {
      expect(e.availability.state, `${e.event.key} should be locked`).toBe('locked')
      // The lock carries the catalog's own CTA — the Builder authors none.
      expect(e.availability.state === 'locked' && e.availability.requirement.cta?.href).toBeTruthy()
    }
  })

  it('and every one of them unlocks the moment its capability is present', () => {
    const external = listSelectableEvents().filter((e) => e.origin === 'external')
    const capabilities = new Set(external.flatMap((e) => e.requirements.map((r) => r.key)))
    const out = evaluateEvents(external, ctx({ capabilities }))
    expect(out.every((e) => e.availability.state === 'available')).toBe(true)
  })
})

/**
 * Connection binding — what gets STORED. Criterion 5 in its narrowest form:
 * only a Source id may become a source id.
 */
describe('binding — stable ids only', () => {
  const withParams = (parameters: EventDefinition['parameters']) => event({ parameters })

  it('stores the values of enum_remote parameters', () => {
    const e = withParams([{ key: 'calendarId', type: 'enum_remote', label: 'יומן', optionSource: 'calendars' }])
    expect(sourceIdsFrom(e, { calendarId: 'cal_9' })).toEqual(['cal_9'])
  })

  it('NEVER stores a static enum — a choice is not a stream identity', () => {
    const e = withParams([
      { key: 'kind', type: 'enum_static', label: 'סוג', options: [{ value: 'demo', label: 'הדגמה' }] },
      { key: 'calendarId', type: 'enum_remote', label: 'יומן', optionSource: 'calendars' },
    ])
    expect(sourceIdsFrom(e, { kind: 'demo', calendarId: 'cal_9' })).toEqual(['cal_9'])
  })

  it('an unanswered parameter stores nothing rather than an empty id', () => {
    const e = withParams([{ key: 'calendarId', type: 'enum_remote', label: 'יומן', optionSource: 'calendars' }])
    expect(sourceIdsFrom(e, { calendarId: '' })).toEqual([])
    expect(sourceIdsFrom(e, {})).toEqual([])
    expect(sourceIdsFrom(e, null)).toEqual([])
  })

  it('an event with no remote parameter binds to nothing and needs no connection', () => {
    for (const e of listSelectableEvents().filter((e) => e.parameters.length === 0)) {
      expect(sourceIdsFrom(e, { anything: 'x' })).toEqual([])
      expect(needsConnection(e)).toBe(false)
    }
  })

  it('an event WITH a remote parameter binds to the id the user picked — B7, no code for it', () => {
    const remote = listSelectableEvents().filter((e) => e.parameters.some((p) => p.type === 'enum_remote'))
    expect(remote.length).toBeGreaterThan(0)
    for (const e of remote) {
      expect(needsConnection(e)).toBe(true)
      const key = e.parameters.find((p) => p.type === 'enum_remote')!.key
      expect(sourceIdsFrom(e, { [key]: 'stable_id_1' })).toEqual(['stable_id_1'])
    }
  })

  it('an event with a remote parameter needs a connection chosen first', () => {
    const e = withParams([{ key: 'calendarId', type: 'enum_remote', label: 'יומן', optionSource: 'calendars' }])
    expect(needsConnection(e)).toBe(true)
  })
})
