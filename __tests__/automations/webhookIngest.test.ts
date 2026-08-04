import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { ingestWebhookWith } from '@/lib/automations/connectors/ingest'
import type { MappedEvent, WebhookConnector } from '@/lib/automations/connectors/types'
import { emitAutomationEventWith, eventKeyFor, type EmitDeps } from '@/lib/automations/emit'
import { getEvent } from '@/lib/automations/catalog/registry'
import { snapshotConditionsMatch } from '@/lib/automations/conditionEvaluator'
import { snapshotFieldsForEvent } from '@/lib/automations/catalog/engineBridge'
import type { AutomationDefinition } from '@/db/automations/definitions'

/**
 * The full inbound chain, proven end to end:
 *
 *   webhook → connector → mapEvent → lead resolution → automation event
 *   → emission (conditions) → job
 *
 * The pipeline under test names no integration, and this test now proves that
 * rather than asserting it: the connector handed in is a STUB defined here.
 * It previously used a shipped provider, which made a generic test read as a
 * test of that provider — and made it break when the provider was removed.
 *
 * The stub speaks `form.submitted` because that is the registered event a
 * webhook actually produces; the appointment occurrence is internal now, emitted
 * by the Meetings domain rather than delivered.
 */

const SECRET = 'whsec_test'
const SIGNATURE_HEADER = 'x-stub-signature'

/**
 * A minimal connector: the §4 Q2 contract and nothing else. Every field it maps
 * is a CATALOG field key, which is the property the pipeline depends on.
 */
const connector: WebhookConnector = {
  integrationKey: 'stub',
  capabilities: ['website_connected'],
  // The outbound half is irrelevant here: the ingest pipeline never calls it.
  async listConnections() {
    return []
  },
  async listSources() {
    return []
  },
  async options() {
    return []
  },
  verifyWebhook({ headers, body }) {
    const header = headers[SIGNATURE_HEADER] ?? ''
    const secret = headers['x-connection-secret'] ?? ''
    if (!header || !secret) return false
    const [t, v1] = header.split(',').map((part) => part.split('=')[1])
    if (!t || !v1) return false
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(v1)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  },
  mapEvent(payload) {
    const body = payload as { type?: string; submission?: Record<string, string> } | null
    if (!body || body.type !== 'form.submission') return null
    const submission = body.submission ?? {}
    if (!submission.id) return null
    return {
      eventKey: 'form.submitted',
      occurrenceKey: `form:stub:${submission.id}`,
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      fields: { formName: submission.formName ?? '', message: submission.message ?? '', pageUrl: submission.pageUrl ?? '' },
      subject: { email: submission.email ?? null, phone: submission.phone ?? null },
    } satisfies MappedEvent
  },
  async resolveSubject() {
    return 42
  },
}

const BOOKING = {
  type: 'form.submission',
  submission: {
    id: 'SUB1',
    email: 'dana@example.com',
    phone: '+972501234567',
    formName: 'צור קשר',
    message: 'אשמח לפרטים',
    pageUrl: 'https://example.co.il/contact',
  },
}

const signed = (payload: unknown) => {
  const body = JSON.stringify(payload)
  const at = '1754140800'
  const v1 = crypto.createHmac('sha256', SECRET).update(`${at}.${body}`).digest('hex')
  return { body, headers: { [SIGNATURE_HEADER]: `t=${at},v1=${v1}`, 'x-connection-secret': SECRET } }
}

const deps = (over: Partial<{ resolveSubject: unknown; emit: unknown }> = {}) =>
  ({
    resolveSubject: vi.fn(async () => 42),
    emit: vi.fn(async () => ({ emitted: 1 })),
    ...over,
  }) as never

describe('the chain accepts a real booking', () => {
  it('verify → map → describe → resolve → emit, producing a canonical engine event', async () => {
    const { body, headers } = signed(BOOKING)
    const d = deps()
    const outcome = await ingestWebhookWith(connector, d, { agencyId: 7, headers, body })

    expect(outcome).toMatchObject({ accepted: true, leadId: 42 })
    expect('event' in outcome && outcome.event).toMatchObject({
      trigger: 'form_submitted',
      // The GENERIC webhook origin — no per-provider value was added for B7.
      origin: 'webhook',
      agencyId: 7,
      leadId: 42,
      occurrenceKey: 'form:stub:SUB1',
    })
  })

  it('the emitted event carries catalog-keyed snapshot fields, not provider ones', async () => {
    const { body, headers } = signed(BOOKING)
    const outcome = await ingestWebhookWith(connector, deps(), { agencyId: 7, headers, body })
    const fields = 'event' in outcome ? outcome.event.fields : null
    expect(Object.keys(fields ?? {}).sort()).toEqual(['formName', 'message', 'pageUrl'])
  })

  it('the connector’s occurrence key becomes the engine’s dedup key, unchanged', async () => {
    const { body, headers } = signed(BOOKING)
    const outcome = await ingestWebhookWith(connector, deps(), { agencyId: 7, headers, body })
    const event = 'event' in outcome ? outcome.event : null
    expect(eventKeyFor(event!)).toBe(event!.occurrenceKey)
  })

  it('two deliveries of the same booking produce the SAME key — the queue dedups them', async () => {
    const { body, headers } = signed(BOOKING)
    const a = await ingestWebhookWith(connector, deps(), { agencyId: 7, headers, body })
    const b = await ingestWebhookWith(connector, deps(), { agencyId: 7, headers, body })
    expect(eventKeyFor(('event' in a ? a.event : null)!)).toBe(eventKeyFor(('event' in b ? b.event : null)!))
  })

  it('the agency comes from the caller, never from the payload — no cross-tenant reach', async () => {
    const hostile = { ...BOOKING, submission: { ...BOOKING.submission, agencyId: '999' } }
    const { body, headers } = signed(hostile)
    const d = deps()
    const outcome = await ingestWebhookWith(connector, d, { agencyId: 7, headers, body })
    expect('event' in outcome && outcome.event.agencyId).toBe(7)
    expect((d as never as { resolveSubject: { mock: { calls: unknown[][] } } }).resolveSubject.mock.calls[0][0]).toBe(7)
  })
})

describe('every rejection is named — a dropped booking is never silent', () => {
  const cases: [string, () => { body: string; headers: Record<string, string> }, string][] = [
    ['invalid_signature', () => ({ ...signed(BOOKING), headers: {} }), 'invalid_signature'],
    [
      'unreadable_payload',
      () => {
        const at = '1754140800'
        const body = 'not json'
        const v1 = crypto.createHmac('sha256', SECRET).update(`${at}.${body}`).digest('hex')
        return { body, headers: { [SIGNATURE_HEADER]: `t=${at},v1=${v1}`, 'x-connection-secret': SECRET } }
      },
      'unreadable_payload',
    ],
    ['not_actionable', () => signed({ type: 'form.deleted', submission: BOOKING.submission }), 'not_actionable'],
  ]

  for (const [name, make, reason] of cases) {
    it(`${name} stops the chain before the engine`, async () => {
      const { body, headers } = make()
      const d = deps()
      const outcome = await ingestWebhookWith(connector, d, { agencyId: 7, headers, body })
      expect(outcome).toEqual({ accepted: false, reason })
      expect((d as never as { emit: { mock: { calls: unknown[] } } }).emit.mock.calls.length).toBe(0)
    })
  }

  it('Law 2 — an unresolvable subject is dropped, never emitted against a guessed lead', async () => {
    const { body, headers } = signed(BOOKING)
    const d = deps({ resolveSubject: vi.fn(async () => null) })
    const outcome = await ingestWebhookWith(connector, d, { agencyId: 7, headers, body })
    expect(outcome).toEqual({ accepted: false, reason: 'subject_unresolved' })
    expect((d as never as { emit: { mock: { calls: unknown[] } } }).emit.mock.calls.length).toBe(0)
  })

  it('Law 3 — a connector naming an undescribed event is inert', async () => {
    const rogue = { ...connector, mapEvent: () => ({ ...connector.mapEvent(BOOKING)!, eventKey: 'payment.received' }) }
    const { body, headers } = signed(BOOKING)
    const outcome = await ingestWebhookWith(rogue as WebhookConnector, deps(), { agencyId: 7, headers, body })
    expect(outcome).toEqual({ accepted: false, reason: 'event_undescribed' })
  })
})

describe('emission treats the external event exactly like an internal one', () => {
  const definition = (conditions: AutomationDefinition['conditions']) =>
    ({
      id: 3,
      agencyId: 7,
      name: 'תזכורת',
      recipeKey: null,
      status: 'active',
      trigger: 'form_submitted',
      action: 'send_email',
      content: { schemaVersion: 1, subject: 's', body: 'b', timing: { kind: 'preset', preset: 'immediate' } },
      createdByUserId: 1,
      conditions,
      actions: [{ actionKey: 'email.send', parameters: { subject: 's', body: 'b' } }],
      connectionId: 'contact_form_7:1',
      sourceIds: [],
    }) as unknown as AutomationDefinition

  const emitDeps = (defs: AutomationDefinition[]): EmitDeps => ({
    enabled: () => true,
    allowlisted: () => true,
    listActive: vi.fn(async () => defs),
    enqueue: vi.fn(async () => 1),
    shadow: vi.fn(async () => {}),
  })

  const eventFor = async () => {
    const { body, headers } = signed(BOOKING)
    const outcome = await ingestWebhookWith(connector, deps(), { agencyId: 7, headers, body })
    return 'event' in outcome ? outcome.event : null
  }

  it('enqueues when the automation has no conditions', async () => {
    const d = emitDeps([definition([])])
    expect(await emitAutomationEventWith(d, (await eventFor())!)).toEqual({
      emitted: 1,
      skippedDefinitions: 0,
      filteredDefinitions: 0,
    })
  })

  it('a SNAPSHOT condition on a connector-mapped field filters at emission — no new code path', async () => {
    const event = (await eventFor())!
    const match = definition([{ field: 'formName', operator: 'contains', value: 'קשר' }])
    const miss = definition([{ field: 'formName', operator: 'contains', value: 'הדגמה' }])
    expect(await emitAutomationEventWith(emitDeps([match]), event)).toMatchObject({ emitted: 1 })
    expect(await emitAutomationEventWith(emitDeps([miss]), event)).toMatchObject({
      emitted: 0,
      filteredDefinitions: 1,
    })
  })

  it('the evaluator reads the connector’s fields through the same bridge as the internal events', async () => {
    const event = (await eventFor())!
    const definition = getEvent('form.submitted')!
    const snapshot = snapshotFieldsForEvent(event)
    expect(snapshot.formName).toBe('צור קשר')
    // The two legacy spellings are still present and null — internal events
    // keep working, which is what "additive" means here.
    expect(snapshot.source).toBe(null)
    expect(snapshotConditionsMatch(definition, [{ field: 'message', operator: 'exists', value: '' }], snapshot).pass).toBe(
      true,
    )
  })
})
