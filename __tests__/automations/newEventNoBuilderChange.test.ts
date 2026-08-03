import { describe, expect, it } from 'vitest'
import type { EventDefinition } from '@/lib/automations/catalog/types'
import { validateEvent } from '@/lib/automations/catalog/validate'
import { conditionableFields, describeCondition, operatorsForField, findField } from '@/lib/automations/conditions'
import { automationSentence, triggerPhrase } from '@/lib/automations/sentence'
import { variableChipsForEvent } from '@/lib/automations/variables'
import { listActionsForEvent, listAnchorFields, catalog } from '@/lib/automations/catalog/registry'
import { getAction } from '@/lib/automations/catalog/registry'
import { evaluateEvent, evaluateEvents } from '@/lib/automations/requirements'
import { optionsFor } from '@/lib/automations/connectors/resolve'
import type { ConnectionProvider } from '@/lib/automations/connectors/types'

/**
 * B3 PROOF: adding a new Event requires ONLY a catalog entry.
 *
 * This synthetic event is deliberately unlike anything the Builder has seen —
 * a different subject, a datetime field, a money field, an enum with its own
 * options. Every Builder-facing capability is then derived from it WITHOUT a
 * single line of Builder code existing for it.
 */

const APPOINTMENT_BOOKED: EventDefinition = {
  key: 'appointment.booked',
  origin: 'external',
  subject: 'lead', // reuses a registered subject; a new one is a catalog row too
  title: 'נקבעה פגישה',
  description: 'כשליד קובע פגישה ביומן',
  icon: 'calendar',
  lifecycle: 'stable',
  requirements: [{ type: 'connection', key: 'calendar', cta: { label: 'חבר יומן', href: '/settings/calendar' } }],
  parameters: [{ key: 'calendarId', type: 'enum_remote', label: 'יומן', optionSource: 'calendars' }],
  fields: [
    { key: 'leadFirstName', type: 'text', label: 'שם הליד', freshness: 'live', lifecycle: 'stable' },
    { key: 'email', type: 'email', label: 'אימייל הליד', freshness: 'live', lifecycle: 'stable' },
    { key: 'startsAt', type: 'datetime', label: 'מועד הפגישה', freshness: 'snapshot', lifecycle: 'stable' },
    { key: 'price', type: 'money', label: 'מחיר', freshness: 'snapshot', lifecycle: 'stable' },
    {
      key: 'kind',
      type: 'enum',
      label: 'סוג הפגישה',
      freshness: 'snapshot',
      lifecycle: 'stable',
      options: [
        { value: 'intro', label: 'שיחת היכרות' },
        { value: 'demo', label: 'הדגמה' },
      ],
    },
  ],
  identity: { occurrenceKey: 'appointment.id', leadResolution: 'by invitee email, then phone' },
}

describe('a brand-new event needs only a catalog entry', () => {
  it('validates against the frozen schema', () => {
    expect(
      validateEvent(
        APPOINTMENT_BOOKED,
        catalog.subjects.map((s) => s.key),
      ),
    ).toEqual([])
  })

  it('produces its own condition fields, with operators derived from each type', () => {
    const fields = conditionableFields(APPOINTMENT_BOOKED)
    expect(fields.map((f) => f.key)).toContain('startsAt')
    // money → numeric operators; enum → membership; datetime → temporal.
    expect(operatorsForField(findField(APPOINTMENT_BOOKED, 'price')!)).toContain('greater_than')
    expect(operatorsForField(findField(APPOINTMENT_BOOKED, 'kind')!)).toContain('is_one_of')
    expect(operatorsForField(findField(APPOINTMENT_BOOKED, 'startsAt')!)).toContain('before')
  })

  it("renders condition values using the field's own declared option labels", () => {
    expect(describeCondition(APPOINTMENT_BOOKED, { field: 'kind', operator: 'is', value: 'demo' })).toBe('סוג הפגישה הוא "הדגמה"')
  })

  it('offers a TIMING ANCHOR automatically — the datetime field lights it up', () => {
    // The capability ADR-007 deferred as webinar-specific scope arrives here
    // for free, purely because the event declares a datetime field.
    expect(listAnchorFields(APPOINTMENT_BOOKED).map((f) => f.label)).toEqual(['מועד הפגישה'])
  })

  it('offers the email action because it exposes an email field', () => {
    expect(listActionsForEvent(APPOINTMENT_BOOKED).map((a) => a.key)).toEqual(['email.send'])
  })

  it('is refused the email action if it exposes no email field', () => {
    const noEmail = { ...APPOINTMENT_BOOKED, fields: APPOINTMENT_BOOKED.fields.filter((f) => f.type !== 'email') }
    expect(listActionsForEvent(noEmail)).toEqual([])
  })

  it('produces variable chips from its own fields', () => {
    expect(variableChipsForEvent(APPOINTMENT_BOOKED.fields).map((c) => c.token)).toEqual(['שם הליד'])
  })

  it('produces a correct sentence with no Builder code naming it', () => {
    expect(triggerPhrase(APPOINTMENT_BOOKED)).toBe('נקבעה פגישה')
    expect(
      automationSentence({
        event: APPOINTMENT_BOOKED,
        conditions: [{ field: 'kind', operator: 'is', value: 'intro' }],
        actionTitle: getAction('email.send')!.title,
        subject: 'נתראה',
        timing: { kind: 'preset', preset: 'one_day' },
      }),
    ).toBe('נקבעה פגישה · רק אם סוג הפגישה הוא "שיחת היכרות" · שליחת אימייל: "נתראה" · אחרי יום')
  })

  it('carries a connection requirement the Builder renders generically', () => {
    const req = APPOINTMENT_BOOKED.requirements[0]
    expect(req.type).toBe('connection')
    expect(req.cta?.href).toBeTruthy()
  })
})

/**
 * B4 EXTENSION OF THE SAME PROOF: the requirement this event declares, and the
 * remote parameter it declares, are both honoured by generic runtime code that
 * has never heard of a calendar.
 */
describe('B4 — the same catalog entry drives requirements and remote parameters', () => {
  const ctx = (caps: string[] = []) => ({
    capabilities: new Set(caps),
    entitlements: new Set<string>(),
    flags: new Set<string>(),
  })

  it('is LOCKED with the catalog-declared CTA until its connection exists', () => {
    const availability = evaluateEvent(APPOINTMENT_BOOKED, ctx())
    expect(availability.state).toBe('locked')
    expect(availability.state === 'locked' && availability.requirement.cta).toEqual({
      label: 'חבר יומן',
      href: '/settings/calendar',
    })
  })

  it('becomes available the moment the capability is present — no Builder change', () => {
    expect(evaluateEvent(APPOINTMENT_BOOKED, ctx(['calendar'])).state).toBe('available')
  })

  it('stays visible while locked — a locked event is explained, never hidden', () => {
    const shown = evaluateEvents([APPOINTMENT_BOOKED], ctx())
    expect(shown.map((e) => e.event.key)).toEqual(['appointment.booked'])
  })

  it('its enum_remote parameter resolves through the generic option provider', async () => {
    const provider: ConnectionProvider = {
      integrationKey: 'gamma',
      capabilities: ['calendar'],
      async listConnections() {
        return []
      },
      async listSources() {
        return []
      },
      async options(_agencyId, _connectionId, optionSource) {
        return optionSource === 'calendars' ? [{ id: 'cal_1', label: 'יומן ראשי' }] : []
      },
    }
    const parameter = APPOINTMENT_BOOKED.parameters[0]
    const options = await optionsFor([provider], 1, 'gamma:1', parameter.optionSource!)
    // The stored value is the STABLE id; the label is display only.
    expect(options).toEqual([{ id: 'cal_1', label: 'יומן ראשי' }])
  })
})
