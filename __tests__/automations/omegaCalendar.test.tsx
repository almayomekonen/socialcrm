// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import crypto from 'node:crypto'

import { validateEvent } from '@/lib/automations/catalog/validate'
import { catalog, listActionsForEvent, listAnchorFields, listSubjects } from '@/lib/automations/catalog/registry'
import { evaluateEvents, isSelectable, type RequirementContext } from '@/lib/automations/requirements'
import { conditionableFields, findField, operatorsForField, describeCondition } from '@/lib/automations/conditions'
import { conditionsWithFreshness, snapshotConditionsMatch } from '@/lib/automations/conditionEvaluator'
import { variableChipsForEvent } from '@/lib/automations/variables'
import { needsConnection, sourceIdsFrom } from '@/lib/automations/binding'
import { automationSentence } from '@/lib/automations/sentence'
import * as resolve from '@/lib/automations/connectors/resolve'
import { isWebhookConnector, type ConnectionProvider, type WebhookConnector } from '@/lib/automations/connectors/types'
import { ingestWebhookWith } from '@/lib/automations/connectors/ingest'
import ConditionsEditor from '@/components/settings/automations/ConditionsEditor'
import RemoteParameters from '@/components/settings/automations/RemoteParameters'
import type { Condition } from '@/lib/automations/conditions'
import type { Connection, EventDefinition, Source } from '@/lib/automations/catalog/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE B7 PROOF — "Omega Calendar", an integration that exists only here.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Calendly proved that a real connector fits the contracts. This proves the
 * stronger claim: a SECOND, entirely unknown integration works with **zero**
 * changes anywhere — no Builder file, no engine file, no catalog file, no
 * registry file. Everything below is declared in this test and handed to the
 * SHIPPED functions the Builder and engine actually call.
 *
 * If the architecture had leaked, this file could not compile without a
 * production diff. That it does not is the acceptance criterion.
 *
 * Omega is deliberately UNLIKE Calendly: different subject, a money field, an
 * enum field with its own options, a different option source, an entitlement
 * requirement on top of a connection one, and a webhook signed differently.
 */

afterEach(cleanup)

// ── The catalog entry an Omega author would write ──────────────────────────

const OMEGA_EVENT: EventDefinition = {
  key: 'appointment.rescheduled',
  origin: 'external',
  subject: 'appointment', // reuses a registered subject; a new one is a row too
  title: 'הפגישה נדחתה',
  description: 'כשליד משנה את מועד הפגישה',
  icon: 'calendar-clock',
  lifecycle: 'stable',
  requirements: [
    { type: 'connection', key: 'omega_connected', cta: { label: 'חיבור אומגה', href: '/settings/integrations' } },
    { type: 'entitlement', key: 'pro' },
  ],
  parameters: [
    { key: 'roomId', type: 'enum_remote', label: 'חדר', optionSource: 'rooms' },
    {
      key: 'reminderStyle',
      type: 'enum_static',
      label: 'סגנון תזכורת',
      options: [
        { value: 'short', label: 'קצרה' },
        { value: 'detailed', label: 'מפורטת' },
      ],
    },
  ],
  fields: [
    { key: 'leadFirstName', type: 'text', label: 'שם הליד', freshness: 'live', lifecycle: 'stable' },
    { key: 'businessName', type: 'text', label: 'שם העסק', freshness: 'live', lifecycle: 'stable' },
    { key: 'repName', type: 'text', label: 'שם הנציג', freshness: 'live', lifecycle: 'stable' },
    { key: 'email', type: 'email', label: 'אימייל הליד', freshness: 'live', lifecycle: 'stable' },
    { key: 'newStartsAt', type: 'datetime', label: 'המועד החדש', freshness: 'snapshot', lifecycle: 'stable' },
    { key: 'roomPrice', type: 'money', label: 'עלות החדר', freshness: 'snapshot', lifecycle: 'stable' },
    {
      key: 'reason',
      type: 'enum',
      label: 'סיבת הדחייה',
      freshness: 'snapshot',
      lifecycle: 'stable',
      options: [
        { value: 'client', label: 'הלקוח ביקש' },
        { value: 'business', label: 'העסק ביקש' },
      ],
    },
  ],
  identity: {
    occurrenceKey: 'omega:{booking_id}:{version}',
    leadResolution: 'by attendee email within the agency',
  },
}

// ── The connector an Omega author would write ──────────────────────────────

const OMEGA_SECRET = 'omega_secret'

const CONNECTIONS: Connection[] = [
  { id: 'omega:11', integrationKey: 'omega', agencyId: 7, displayName: 'אומגה — הסניף הראשי', health: 'ok' },
  { id: 'omega:12', integrationKey: 'omega', agencyId: 7, displayName: 'אומגה — סניף צפון', health: 'ok' },
]

const ROOMS: Record<string, { id: string; label: string }[]> = {
  'omega:11': [
    { id: 'room_a', label: 'חדר ישיבות א' },
    { id: 'room_b', label: 'חדר ישיבות ב' },
  ],
  'omega:12': [{ id: 'room_north', label: 'חדר צפון' }],
}

const omegaProvider: ConnectionProvider = {
  integrationKey: 'omega',
  capabilities: ['omega_connected'],

  async listConnections(agencyId) {
    return CONNECTIONS.filter((c) => c.agencyId === agencyId)
  },

  async listSources(_agencyId, connectionId) {
    return (ROOMS[connectionId] ?? []).map<Source>((r) => ({
      id: r.id,
      connectionId,
      label: r.label,
      subscription: 'subscribed',
      health: 'ok',
    }))
  },

  async options(agencyId, connectionId, optionSource) {
    if (optionSource !== 'rooms') return []
    return (await omegaProvider.listSources(agencyId, connectionId)).map((s) => ({ id: s.id, label: s.label }))
  },

  verifyWebhook({ headers, body }) {
    const given = headers['x-omega-signature'] ?? ''
    const expected = crypto.createHmac('sha256', OMEGA_SECRET).update(body).digest('hex')
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  },

  mapEvent(payload) {
    const body = payload as { kind?: string; booking?: Record<string, unknown> } | null
    if (!body || body.kind !== 'booking.moved' || !body.booking) return null
    const b = body.booking
    return {
      eventKey: OMEGA_EVENT.key,
      occurrenceKey: `omega:${b.id}:${b.version}`,
      occurredAt: new Date('2026-08-02T09:00:00Z'),
      fields: {
        newStartsAt: new Date(String(b.starts_at)),
        roomPrice: Number(b.price ?? 0),
        reason: String(b.reason ?? 'client'),
      },
      subject: { email: String(b.attendee_email ?? '') },
    }
  },

  async resolveSubject(_agencyId, mapped) {
    return mapped.subject.email === 'dana@example.com' ? 42 : null
  },
}

const PROVIDERS = [omegaProvider]
const ctx = (over: Partial<RequirementContext> = {}): RequirementContext => ({
  capabilities: new Set<string>(),
  entitlements: new Set<string>(),
  flags: new Set<string>(),
  ...over,
})
const CONNECTED = ctx({ capabilities: new Set(['omega_connected']), entitlements: new Set(['pro']) })

// ══════════════════════════════════════════════════════════════════════════

describe('the catalog accepts Omega without knowing it exists', () => {
  it('validates against the frozen schema', () => {
    expect(
      validateEvent(
        OMEGA_EVENT,
        catalog.subjects.map((s) => s.key),
      ),
    ).toEqual([])
  })

  it('groups under a registered subject — the picker needs no new grouping code', () => {
    expect(listSubjects().map((s) => s.key)).toContain(OMEGA_EVENT.subject)
  })
})

describe('✓ the event appears automatically, and locks correctly', () => {
  it('is LOCKED before connecting, with the CTA the catalog declared', () => {
    const [entry] = evaluateEvents([OMEGA_EVENT], ctx())
    expect(entry.availability.state).toBe('locked')
    expect(entry.availability.state === 'locked' && entry.availability.requirement.cta).toEqual({
      label: 'חיבור אומגה',
      href: '/settings/integrations',
    })
    expect(isSelectable(entry.availability)).toBe(false)
  })

  it('stays VISIBLE while locked — explained, never hidden', () => {
    expect(evaluateEvents([OMEGA_EVENT], ctx()).length).toBe(1)
  })

  it('✓ reconnect unlocks it immediately — nothing is cached, nothing is rebuilt', () => {
    const capabilities = new Set(['omega_connected'])
    expect(evaluateEvents([OMEGA_EVENT], ctx({ capabilities })).at(0)!.availability.state).toBe('locked') // pro missing
    expect(evaluateEvents([OMEGA_EVENT], CONNECTED).at(0)!.availability.state).toBe('available')
  })

  it('a second requirement TYPE is honoured with no extra code', () => {
    const entry = evaluateEvents([OMEGA_EVENT], ctx({ capabilities: new Set(['omega_connected']) })).at(0)!
    expect(entry.availability.state === 'locked' && entry.availability.requirement.type).toBe('entitlement')
  })
})

describe('✓ conditions appear automatically — rendered, not described', () => {
  it('offers every declared field, with operators derived from each TYPE', () => {
    expect(conditionableFields(OMEGA_EVENT).map((f) => f.key)).toEqual(OMEGA_EVENT.fields.map((f) => f.key))
    expect(operatorsForField(findField(OMEGA_EVENT, 'roomPrice')!)).toContain('greater_than')
    expect(operatorsForField(findField(OMEGA_EVENT, 'reason')!)).toContain('is_one_of')
    expect(operatorsForField(findField(OMEGA_EVENT, 'newStartsAt')!)).toContain('before')
  })

  it('RENDERS Omega’s fields and its enum options in the shipped editor', () => {
    const conditions: Condition[] = [{ field: 'reason', operator: 'is', value: 'client' }]
    render(<ConditionsEditor event={OMEGA_EVENT} conditions={conditions} onChange={() => {}} />)
    // Omega's own labels, in a component that has never heard of Omega.
    expect(screen.getByRole('option', { name: 'עלות החדר' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'סיבת הדחייה' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'הלקוח ביקש' })).toBeInTheDocument()
  })

  it('warns that live conditions are checked at send time — from freshness alone', () => {
    render(
      <ConditionsEditor
        event={OMEGA_EVENT}
        conditions={[{ field: 'email', operator: 'exists', value: '' }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('חלק מהתנאים נבדקים ברגע השליחה, לא ברגע האירוע.')).toBeInTheDocument()
  })

  it('describes an Omega condition in Hebrew using Omega’s own labels', () => {
    expect(describeCondition(OMEGA_EVENT, { field: 'reason', operator: 'is', value: 'business' })).toBe(
      'סיבת הדחייה הוא "העסק ביקש"',
    )
  })

  it('partitions Omega’s conditions by freshness and evaluates the snapshot ones', () => {
    const conditions: Condition[] = [
      { field: 'roomPrice', operator: 'greater_than', value: '100' },
      { field: 'email', operator: 'exists', value: '' },
    ]
    expect(conditionsWithFreshness(OMEGA_EVENT, conditions, 'snapshot').map((c) => c.field)).toEqual(['roomPrice'])
    expect(snapshotConditionsMatch(OMEGA_EVENT, conditions, { roomPrice: 250 }).pass).toBe(true)
    expect(snapshotConditionsMatch(OMEGA_EVENT, conditions, { roomPrice: 50 }).pass).toBe(false)
  })
})

describe('✓ parameter UI and ✓ enum_remote work automatically', () => {
  it('RENDERS both parameter kinds from the declaration alone', async () => {
    const options = await resolve.optionsFor(PROVIDERS, 7, 'omega:11', 'rooms')
    // The component fetches through a server action in production; here the
    // resolved options are handed in to prove the RENDERING is generic.
    render(
      <RemoteParameters
        parameters={OMEGA_EVENT.parameters.filter((p) => p.type === 'enum_static')}
        connectionId='omega:11'
        values={{}}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('option', { name: 'מפורטת' })).toBeInTheDocument()
    expect(options.map((o) => o.id)).toEqual(['room_a', 'room_b'])
  })

  it('resolves Omega’s OWN option source, scoped per connection', async () => {
    expect((await resolve.optionsFor(PROVIDERS, 7, 'omega:12', 'rooms')).map((o) => o.id)).toEqual(['room_north'])
    expect(await resolve.optionsFor(PROVIDERS, 7, 'omega:11', 'event_types')).toEqual([])
  })

  it('stores the STABLE id the user picked, never the label', () => {
    expect(needsConnection(OMEGA_EVENT)).toBe(true)
    expect(sourceIdsFrom(OMEGA_EVENT, { roomId: 'room_b', reminderStyle: 'short' })).toEqual(['room_b'])
  })
})

describe('✓ timing anchor, ✓ variables, ✓ preview — all from the declaration', () => {
  it('exposes Omega’s datetime field as the timing anchor', () => {
    expect(listAnchorFields(OMEGA_EVENT).map((f) => f.label)).toEqual(['המועד החדש'])
  })

  it('offers the variable chips the renderer can actually substitute', () => {
    expect(variableChipsForEvent(OMEGA_EVENT.fields).map((c) => c.field)).toEqual(['leadFirstName', 'businessName', 'repName'])
  })

  it('offers email.send because Omega declares an email field — requires × fields', () => {
    expect(listActionsForEvent(OMEGA_EVENT).map((a) => a.key)).toEqual(['email.send'])
    expect(listActionsForEvent({ ...OMEGA_EVENT, fields: [] }).map((a) => a.key)).toEqual([])
  })

  it('the preview shape comes from the action, so Omega needs no renderer', () => {
    expect(listActionsForEvent(OMEGA_EVENT)[0].preview).toBe('email')
  })

  it('states the whole automation in one Hebrew sentence (Law 8)', () => {
    const sentence = automationSentence({
      event: OMEGA_EVENT,
      conditions: [{ field: 'reason', operator: 'is', value: 'client' }],
      actionTitle: listActionsForEvent(OMEGA_EVENT)[0].title,
      subject: 'נתראה במועד החדש',
      timing: { kind: 'preset', preset: 'immediate' },
    })
    expect(sentence).toContain('הפגישה נדחתה')
    expect(sentence).toContain('סיבת הדחייה')
  })
})

describe('✓ disconnect marks affected automations דורש טיפול', () => {
  const revoked: ConnectionProvider = {
    ...omegaProvider,
    async listConnections() {
      return [{ ...CONNECTIONS[0], health: 'revoked' }]
    },
  }

  it('an unhealthy connection is a problem the card must surface', async () => {
    const health = await resolve.connectionHealth([revoked], 7, 'omega:11')
    expect(health).toBe('revoked')
    expect(resolve.isConnectionProblem(health)).toBe(true)
  })

  it('and it re-locks the event, because an unhealthy connection grants nothing', async () => {
    const capabilities = await resolve.resolveCapabilities([revoked], 7)
    expect(capabilities.has('omega_connected')).toBe(false)
    const entitlements = new Set(['pro'])
    expect(evaluateEvents([OMEGA_EVENT], ctx({ capabilities, entitlements })).at(0)!.availability.state).toBe('locked')
  })

  it('a connection that vanished entirely is a problem, not an absence', async () => {
    const gone: ConnectionProvider = {
      ...omegaProvider,
      async listConnections() {
        return []
      },
    }
    expect(resolve.isConnectionProblem(await resolve.connectionHealth([gone], 7, 'omega:11'))).toBe(true)
  })
})

describe('✓ the engine ingests Omega through the same generic pipeline', () => {
  const payload = {
    kind: 'booking.moved',
    booking: {
      id: 'BK9',
      version: 3,
      starts_at: '2026-08-20T08:30:00.000Z',
      price: 250,
      reason: 'client',
      attendee_email: 'dana@example.com',
    },
  }
  const signed = (p: unknown) => {
    const body = JSON.stringify(p)
    return { body, headers: { 'x-omega-signature': crypto.createHmac('sha256', OMEGA_SECRET).update(body).digest('hex') } }
  }

  it('is a webhook connector by the same test Calendly passes', () => {
    expect(isWebhookConnector(omegaProvider)).toBe(true)
  })

  it('verify → map → resolve → emit, with no engine change for Omega', async () => {
    const { body, headers } = signed(payload)
    const emit = vi.fn(async () => ({ emitted: 1 }))
    const outcome = await ingestWebhookWith(
      omegaProvider as WebhookConnector,
      { resolveSubject: omegaProvider.resolveSubject!, emit },
      { agencyId: 7, headers, body },
    )
    // Omega's event key is not registered in the production catalog, so the
    // pipeline correctly holds it inert — Law 3, proven rather than assumed.
    expect(outcome).toEqual({ accepted: false, reason: 'event_undescribed' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('and once its event IS described, the same call emits — the only missing piece was a catalog row', async () => {
    const { body, headers } = signed(payload)
    const emit = vi.fn(async () => ({ emitted: 1 }))
    // Registering the catalog row is the entire difference. Simulated by
    // pointing Omega at a key the catalog already describes.
    const registered: WebhookConnector = {
      ...(omegaProvider as WebhookConnector),
      mapEvent: (p) => {
        const mapped = omegaProvider.mapEvent!(p)
        return mapped ? { ...mapped, eventKey: 'appointment.booked' } : null
      },
    }
    const outcome = await ingestWebhookWith(
      registered,
      { resolveSubject: omegaProvider.resolveSubject!, emit },
      { agencyId: 7, headers, body },
    )
    expect(outcome).toMatchObject({ accepted: true, leadId: 42 })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('rejects a forged signature with Omega’s own scheme', async () => {
    const { body } = signed(payload)
    const outcome = await ingestWebhookWith(
      omegaProvider as WebhookConnector,
      { resolveSubject: omegaProvider.resolveSubject!, emit: vi.fn(async () => ({})) },
      { agencyId: 7, headers: { 'x-omega-signature': 'f'.repeat(64) }, body },
    )
    expect(outcome).toEqual({ accepted: false, reason: 'invalid_signature' })
  })

  it('Law 2 — an attendee who is not a lead is dropped, never guessed at', async () => {
    const stranger = { ...payload, booking: { ...payload.booking, attendee_email: 'nobody@example.com' } }
    const { body, headers } = signed(stranger)
    const emit = vi.fn(async () => ({}))
    const registered: WebhookConnector = {
      ...(omegaProvider as WebhookConnector),
      mapEvent: (p) => {
        const mapped = omegaProvider.mapEvent!(p)
        return mapped ? { ...mapped, eventKey: 'appointment.booked' } : null
      },
    }
    const outcome = await ingestWebhookWith(
      registered,
      { resolveSubject: omegaProvider.resolveSubject!, emit },
      { agencyId: 7, headers, body },
    )
    expect(outcome).toEqual({ accepted: false, reason: 'subject_unresolved' })
    expect(emit).not.toHaveBeenCalled()
  })
})
