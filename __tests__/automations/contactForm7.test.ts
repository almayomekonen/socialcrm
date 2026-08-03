import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { contactForm7Provider } from '@/lib/automations/connectors/contactForm7'
import { isWebhookConnector, type ConnectionProvider, type WebhookConnector } from '@/lib/automations/connectors/types'
import { ingestWebhookWith } from '@/lib/automations/connectors/ingest'
import { getEvent, listIntegrations } from '@/lib/automations/catalog/registry'
import { evaluateEvents } from '@/lib/automations/requirements'
import { snapshotConditionsMatch } from '@/lib/automations/conditionEvaluator'
import { snapshotFieldsForEvent } from '@/lib/automations/catalog/engineBridge'
import * as resolve from '@/lib/automations/connectors/resolve'
import type { EventDefinition } from '@/lib/automations/catalog/types'

/**
 * C1 — the Contact Form 7 connector against the generic contract.
 *
 * The only CF7-aware assertions in the suite, beside the only CF7-aware module.
 * Everything else about C1 is exercised by code that has never heard of
 * WordPress — which is the whole claim.
 */

const SECRET = 'whsec_cf7'
const EVENT = getEvent('form.submitted') as EventDefinition

const sign = (body: string) => ({
  'x-socialcrm-signature': crypto.createHmac('sha256', SECRET).update(body).digest('hex'),
  'x-connection-secret': SECRET,
})

const SUBMISSION = {
  form_id: 42,
  form_title: 'צור קשר',
  submission_id: 'sub_9',
  page_url: 'https://example.com/contact/',
  fields: {
    'your-name': 'דנה לוי',
    'your-email': 'Dana@Example.com',
    'your-tel': '050-123-4567',
    'your-message': 'אשמח לפרטים על השירות',
  },
}

describe('it satisfies the generic contract', () => {
  it('is a webhook connector — all three inbound members present', () => {
    expect(isWebhookConnector(contactForm7Provider)).toBe(true)
  })

  it('declares the capability the catalog event requires', () => {
    expect(contactForm7Provider.capabilities).toEqual(expect.arrayContaining(EVENT.requirements.map((r) => r.key)))
  })

  it('answers the option source the catalog event declares, and no other', async () => {
    expect(EVENT.parameters.find((p) => p.type === 'enum_remote')?.optionSource).toBe('forms')
    expect(await contactForm7Provider.options(1, 'contact_form_7:1', 'event_types')).toEqual([])
  })

  it('ignores a connection id belonging to another integration', async () => {
    expect(await contactForm7Provider.listSources(1, 'calendly:5')).toEqual([])
    expect(await contactForm7Provider.listSources(1, 'contact_form_7:not-a-number')).toEqual([])
  })
})

describe('webhook verification', () => {
  const body = JSON.stringify(SUBMISSION)

  it('accepts a correctly signed body', () => {
    expect(contactForm7Provider.verifyWebhook!({ headers: sign(body), body })).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(contactForm7Provider.verifyWebhook!({ headers: sign(body), body: body.replace('דנה', 'רונה') })).toBe(false)
  })

  it('rejects the wrong secret — a leak is contained to one site', () => {
    const headers = { ...sign(body), 'x-connection-secret': 'whsec_other' }
    expect(contactForm7Provider.verifyWebhook!({ headers, body })).toBe(false)
  })

  it('rejects a missing or wrong-length signature without throwing', () => {
    expect(contactForm7Provider.verifyWebhook!({ headers: {}, body })).toBe(false)
    expect(contactForm7Provider.verifyWebhook!({ headers: { 'x-connection-secret': SECRET }, body })).toBe(false)
    expect(
      contactForm7Provider.verifyWebhook!({
        headers: { 'x-socialcrm-signature': 'abcd', 'x-connection-secret': SECRET },
        body,
      }),
    ).toBe(false)
  })
})

describe('event mapping — WordPress vocabulary in, CATALOG vocabulary out', () => {
  it('produces the catalog event key, an occurrence identity and catalog-keyed fields', () => {
    const mapped = contactForm7Provider.mapEvent!(SUBMISSION)!
    expect(mapped.eventKey).toBe('form.submitted')
    expect(mapped.occurrenceKey).toBe('form:42:sub_9')
    expect(mapped.fields).toMatchObject({
      formName: 'צור קשר',
      message: 'אשמח לפרטים על השירות',
      pageUrl: 'https://example.com/contact/',
    })
    expect(mapped.subject).toEqual({ email: 'Dana@Example.com', phone: '050-123-4567' })
  })

  it('every field key the catalog DECLARES is mapped, and nothing declared is invented', () => {
    const declared = new Set(EVENT.fields.map((f) => f.key))
    const mapped = contactForm7Provider.mapEvent!(SUBMISSION)!
    for (const key of ['formName', 'message', 'pageUrl']) {
      expect(declared.has(key), `"${key}" is mapped but not declared`).toBe(true)
      expect(mapped.fields[key]).toBeDefined()
    }
  })

  it('reads author-chosen field names — Hebrew labels included', () => {
    const hebrew = {
      ...SUBMISSION,
      fields: { שם: 'יוסי', 'אימייל-1': 'yossi@example.com', טלפון: '0521112222', הודעה: 'שלום' },
    }
    const mapped = contactForm7Provider.mapEvent!(hebrew)!
    expect(mapped.subject).toEqual({ email: 'yossi@example.com', phone: '0521112222' })
    expect(mapped.fields.message).toBe('שלום')
  })

  it('falls back to the VALUE’s shape when the label is unrecognisable', () => {
    const opaque = { ...SUBMISSION, fields: { 'field-1': 'someone@example.com', 'field-2': '0509998888' } }
    const mapped = contactForm7Provider.mapEvent!(opaque)!
    expect(mapped.subject).toEqual({ email: 'someone@example.com', phone: '0509998888' })
  })

  it('collapses a multi-value field rather than dropping it', () => {
    const multi = { ...SUBMISSION, fields: { ...SUBMISSION.fields, 'your-message': ['שורה', 'שנייה'] } }
    expect(contactForm7Provider.mapEvent!(multi)!.fields.message).toBe('שורה, שנייה')
  })

  it('Law 2 decided early: a submission with no way to reach anyone is not an occurrence', () => {
    const anonymous = { ...SUBMISSION, fields: { 'your-message': 'רק טקסט' } }
    expect(contactForm7Provider.mapEvent!(anonymous)).toBe(null)
  })

  it('returns null for junk rather than throwing or guessing', () => {
    expect(contactForm7Provider.mapEvent!(null)).toBe(null)
    expect(contactForm7Provider.mapEvent!('nope')).toBe(null)
    expect(contactForm7Provider.mapEvent!({})).toBe(null)
    expect(contactForm7Provider.mapEvent!({ form_id: 42 })).toBe(null)
  })

  it('an absent submission id falls back to a CONTENT hash, so retries dedup', () => {
    const { submission_id, ...withoutId } = SUBMISSION
    const a = contactForm7Provider.mapEvent!(withoutId)!
    const b = contactForm7Provider.mapEvent!(withoutId)!
    expect(a.occurrenceKey).toBe(b.occurrenceKey)
    expect(a.occurrenceKey).not.toBe('form:42:sub_9')
  })

  it('two different submissions of the same form are different occurrences', () => {
    const other = { ...SUBMISSION, submission_id: 'sub_10' }
    expect(contactForm7Provider.mapEvent!(SUBMISSION)!.occurrenceKey).not.toBe(
      contactForm7Provider.mapEvent!(other)!.occurrenceKey,
    )
  })
})

describe('the generic pipeline carries it end to end', () => {
  const connector = contactForm7Provider as WebhookConnector
  const body = JSON.stringify(SUBMISSION)

  it('verify → map → describe → resolve → emit produces a canonical engine event', async () => {
    const emit = vi.fn(async () => ({ emitted: 1 }))
    const outcome = await ingestWebhookWith(
      connector,
      { resolveSubject: async () => 42, emit },
      { agencyId: 7, headers: sign(body), body },
    )
    expect(outcome).toMatchObject({ accepted: true, leadId: 42 })
    expect('event' in outcome && outcome.event).toMatchObject({
      trigger: 'form_submitted',
      origin: 'webhook', // the GENERIC origin — C1 appended no per-provider value
      agencyId: 7,
      leadId: 42,
      occurrenceKey: 'form:42:sub_9',
    })
  })

  it('a bad signature stops the chain before anything is queued', async () => {
    const emit = vi.fn(async () => ({}))
    const outcome = await ingestWebhookWith(
      connector,
      { resolveSubject: async () => 42, emit },
      { agencyId: 7, headers: {}, body },
    )
    expect(outcome).toEqual({ accepted: false, reason: 'invalid_signature' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('an unresolvable subject is dropped, never emitted against a guessed lead', async () => {
    const emit = vi.fn(async () => ({}))
    const outcome = await ingestWebhookWith(
      connector,
      { resolveSubject: async () => null, emit },
      { agencyId: 7, headers: sign(body), body },
    )
    expect(outcome).toEqual({ accepted: false, reason: 'subject_unresolved' })
    expect(emit).not.toHaveBeenCalled()
  })

  it('the agency comes from the caller, never the payload — no cross-tenant reach', async () => {
    const hostile = JSON.stringify({ ...SUBMISSION, agencyId: 999, fields: SUBMISSION.fields })
    const seen: number[] = []
    const outcome = await ingestWebhookWith(
      connector,
      {
        resolveSubject: async (agencyId) => {
          seen.push(agencyId)
          return 42
        },
        emit: async () => ({}),
      },
      { agencyId: 7, headers: sign(hostile), body: hostile },
    )
    expect(seen).toEqual([7])
    expect('event' in outcome && outcome.event.agencyId).toBe(7)
  })
})

describe('the Builder gets its whole experience from the catalog row', () => {
  const ctx = (capabilities: string[] = []) => ({
    capabilities: new Set(capabilities),
    entitlements: new Set<string>(),
    flags: new Set<string>(),
  })

  it('is LOCKED with the catalog’s own CTA until a site is connected', () => {
    const entry = evaluateEvents([EVENT], ctx()).at(0)!
    expect(entry.availability.state).toBe('locked')
    expect(entry.availability.state === 'locked' && entry.availability.requirement.cta?.label).toBe('חיבור האתר')
  })

  it('unlocks the moment the capability is present', () => {
    expect(evaluateEvents([EVENT], ctx(['wordpress_form_connected'])).at(0)!.availability.state).toBe('available')
  })

  it('registers as data only — presentation plus one closed-set auth strategy', () => {
    const integration = listIntegrations().find((i) => i.key === 'contact_form_7')!
    expect(integration).toMatchObject({ auth: 'api_key', capabilities: ['wordpress_form_connected'] })
  })
})

describe('conditions work on the connector’s own fields, with no new machinery', () => {
  const eventFrom = () => {
    const mapped = contactForm7Provider.mapEvent!(SUBMISSION)!
    return snapshotFieldsForEvent({
      trigger: 'form_submitted',
      origin: 'webhook',
      agencyId: 7,
      leadId: 42,
      occurredAt: new Date(),
      fields: mapped.fields,
      occurrenceKey: mapped.occurrenceKey,
    })
  }

  it('narrows by form name at emission — a snapshot field, decided before the queue', () => {
    const snapshot = eventFrom()
    expect(snapshotConditionsMatch(EVENT, [{ field: 'formName', operator: 'contains', value: 'צור' }], snapshot).pass).toBe(true)
    expect(snapshotConditionsMatch(EVENT, [{ field: 'formName', operator: 'is', value: 'הרשמה' }], snapshot).pass).toBe(false)
  })

  it('narrows by what the person wrote', () => {
    const snapshot = eventFrom()
    expect(snapshotConditionsMatch(EVENT, [{ field: 'message', operator: 'contains', value: 'פרטים' }], snapshot).pass).toBe(true)
  })

  it('and by the page it came from — a url field, an existing type', () => {
    const snapshot = eventFrom()
    expect(snapshotConditionsMatch(EVENT, [{ field: 'pageUrl', operator: 'exists', value: '' }], snapshot).pass).toBe(true)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE C1 PROOF — a SECOND WordPress form plugin, existing only in this file.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "Gravity Forms" has a different payload shape, a different signing scheme and
 * a different id vocabulary. It reuses the SAME catalog event, so it needs no
 * catalog row at all — one connector and one registry line, and nothing else in
 * the system changes.
 */
describe('another WordPress form plugin needs only a connector and a registry line', () => {
  const GF_SECRET = 'gf_secret'

  const gravityForms: ConnectionProvider = {
    integrationKey: 'gravity_forms',
    capabilities: ['wordpress_form_connected'], // the SAME capability
    async listConnections(agencyId) {
      return [
        {
          id: 'gravity_forms:1',
          integrationKey: 'gravity_forms',
          agencyId,
          displayName: 'Gravity Forms',
          health: 'ok',
        },
      ]
    },
    async listSources(_agencyId, connectionId) {
      return [{ id: 'gf_7', connectionId, label: 'טופס הרשמה', subscription: 'subscribed', health: 'ok' }]
    },
    async options(agencyId, connectionId, optionSource) {
      if (optionSource !== 'forms') return []
      return (await gravityForms.listSources!(agencyId, connectionId)).map((s) => ({ id: s.id, label: s.label }))
    },
    verifyWebhook({ headers, body }) {
      // A different scheme entirely: base64, its own header.
      const given = headers['x-gf-signature'] ?? ''
      const expected = crypto.createHmac('sha256', GF_SECRET).update(body).digest('base64')
      return given === expected
    },
    mapEvent(payload) {
      const p = payload as { entry?: Record<string, string>; form?: { id?: number; title?: string } } | null
      if (!p?.entry || !p.form?.id) return null
      return {
        eventKey: 'form.submitted', // the SAME catalog event
        occurrenceKey: `form:gf:${p.entry.id}`,
        occurredAt: new Date(),
        fields: { formName: p.form.title ?? '', message: p.entry.message ?? '', pageUrl: p.entry.source_url ?? '' },
        subject: { email: p.entry.email ?? null, phone: p.entry.phone ?? null },
      }
    },
    async resolveSubject(_agencyId, mapped) {
      return mapped.subject.email ? 77 : null
    },
  }

  const GF_PAYLOAD = {
    form: { id: 7, title: 'טופס הרשמה' },
    entry: {
      id: 'e12',
      email: 'gf@example.com',
      phone: '0501112222',
      message: 'רוצה להירשם',
      source_url: 'https://wp.example/signup',
    },
  }
  const gfBody = JSON.stringify(GF_PAYLOAD)
  const gfHeaders = { 'x-gf-signature': crypto.createHmac('sha256', GF_SECRET).update(gfBody).digest('base64') }

  it('needs NO catalog row — it reuses form.submitted as declared', () => {
    expect(getEvent(gravityForms.mapEvent!(GF_PAYLOAD)!.eventKey)).toBeTruthy()
  })

  it('registration is the whole change: listing, sources and options all work', async () => {
    const providers = [contactForm7Provider, gravityForms]
    expect((await resolve.listAllConnections(providers, 7)).map((c) => c.id)).toContain('gravity_forms:1')
    expect((await resolve.optionsFor(providers, 7, 'gravity_forms:1', 'forms')).map((o) => o.id)).toEqual(['gf_7'])
    expect(resolve.providerForConnection(providers, 'gravity_forms:1')?.integrationKey).toBe('gravity_forms')
  })

  it('its capability unlocks the same event, so the Builder needs no change either', async () => {
    const capabilities = await resolve.resolveCapabilities([gravityForms], 7)
    expect(evaluateEvents([EVENT], { capabilities, entitlements: new Set(), flags: new Set() }).at(0)!.availability.state).toBe(
      'available',
    )
  })

  it('its own signing scheme is honoured, and a forged one rejected', async () => {
    const emit = vi.fn(async () => ({}))
    const ok = await ingestWebhookWith(
      gravityForms as WebhookConnector,
      { resolveSubject: gravityForms.resolveSubject!, emit },
      { agencyId: 7, headers: gfHeaders, body: gfBody },
    )
    expect(ok).toMatchObject({ accepted: true, leadId: 77 })

    const bad = await ingestWebhookWith(
      gravityForms as WebhookConnector,
      { resolveSubject: gravityForms.resolveSubject!, emit },
      { agencyId: 7, headers: { 'x-gf-signature': 'nope' }, body: gfBody },
    )
    expect(bad).toEqual({ accepted: false, reason: 'invalid_signature' })
  })

  it('its submissions produce the same engine trigger and pass the same conditions', async () => {
    const outcome = await ingestWebhookWith(
      gravityForms as WebhookConnector,
      { resolveSubject: gravityForms.resolveSubject!, emit: async () => ({}) },
      { agencyId: 7, headers: gfHeaders, body: gfBody },
    )
    const event = 'event' in outcome ? outcome.event : null
    expect(event!.trigger).toBe('form_submitted')
    const snapshot = snapshotFieldsForEvent(event!)
    expect(snapshotConditionsMatch(EVENT, [{ field: 'formName', operator: 'contains', value: 'הרשמה' }], snapshot).pass).toBe(
      true,
    )
  })
})
