import 'server-only'
import crypto from 'node:crypto'
import { db } from '@/config/db'
import type { Connection, ConnectionOption, Source } from '../catalog/types'
import type { ConnectionProvider, MappedEvent } from './types'

/**
 * The Calendly connector — B7's proof integration.
 *
 * Everything Calendly-specific in this system is in this one file. Above it,
 * nothing knows Calendly exists: the Builder renders catalog metadata, the
 * engine executes actions, and the registry routes by connection id. That is
 * the claim B7 tests, and this file is the only place it can be broken.
 *
 * It implements the full §4 Q2 contract: listConnections / listSources /
 * options / verifyWebhook / mapEvent / resolveSubject, with health derived
 * from the stored authorisation state.
 */

const INTEGRATION_KEY = 'calendly'

/**
 * Connections live in the generic `automation_connections` table. Unlike
 * WhatsApp — which had a table of its own predating the Connection layer —
 * a brand-new integration has nowhere to live, so B7 adds the generic store
 * every future connector will use. No per-integration table, ever again.
 */
type ConnectionRow = {
  id: number
  agencyId: number
  integrationKey: string
  externalId: string | null
  displayName: string | null
  accessToken: string | null
  refreshToken: string | null
  webhookSecret: string | null
  expiresAt: Date | string | null
  revokedAt: Date | string | null
}

/** Stable across re-authorisation: the row id — never a token, never a label. */
const connectionId = (row: ConnectionRow) => `${INTEGRATION_KEY}:${row.id}`

const asDate = (v: Date | string | null): Date | null => (v ? new Date(v) : null)

/**
 * Health from stored state alone — no network call. A revoked authorisation is
 * `revoked`; an expired token is `needs_reauth`; a connection with no token
 * cannot serve anything, so it is `degraded` rather than quietly `ok`.
 */
function healthOf(row: ConnectionRow): Connection['health'] {
  if (row.revokedAt) return 'revoked'
  if (!row.accessToken) return 'degraded'
  const expiry = asDate(row.expiresAt)
  if (expiry && expiry.getTime() <= Date.now() && !row.refreshToken) return 'needs_reauth'
  return 'ok'
}

async function rows(agencyId: number): Promise<ConnectionRow[]> {
  return (await db('automation_connections')
    .select(
      'id',
      'agencyId',
      'integrationKey',
      'externalId',
      'displayName',
      'accessToken',
      'refreshToken',
      'webhookSecret',
      'expiresAt',
      'revokedAt',
    )
    .where({ agencyId, integrationKey: INTEGRATION_KEY })
    .orderBy('id')) as ConnectionRow[]
}

/**
 * Sources are Calendly EVENT TYPES — the bookable meeting kinds on the
 * account. They are what the `event_types` option source resolves to, and what
 * an automation binds to when the user narrows to one meeting kind.
 *
 * Stored in `automation_sources` by the same generic store as connections.
 */
type SourceRow = {
  id: number
  connectionRowId: number
  externalId: string
  label: string | null
  subscription: Source['subscription']
  revokedAt: Date | string | null
}

async function sourceRows(agencyId: number, rowId: number): Promise<SourceRow[]> {
  return (await db('automation_sources')
    .select('id', 'connectionRowId', 'externalId', 'label', 'subscription', 'revokedAt')
    .where({ agencyId, connectionRowId: rowId })
    .orderBy('id')) as SourceRow[]
}

const rowIdOf = (id: string): number | null => {
  const [key, raw] = id.split(':')
  if (key !== INTEGRATION_KEY) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : null
}

// ── Webhook payload (the only place Calendly's own shape is known) ──────────

type CalendlyPayload = {
  event?: string
  payload?: {
    uri?: string
    email?: string
    name?: string
    text_reminder_number?: string
    scheduled_event?: { uri?: string; name?: string; start_time?: string }
  }
}

/** Calendly's own event name for a new booking. */
const BOOKING_CREATED = 'invitee.created'

export const calendlyProvider: ConnectionProvider = {
  integrationKey: INTEGRATION_KEY,
  capabilities: ['calendar_connected'],

  async listConnections(agencyId) {
    return (await rows(agencyId)).map<Connection>((row) => ({
      id: connectionId(row),
      integrationKey: INTEGRATION_KEY,
      agencyId: row.agencyId,
      displayName: row.displayName || 'Calendly',
      health: healthOf(row),
    }))
  },

  async listSources(agencyId, id) {
    const rowId = rowIdOf(id)
    if (rowId == null) return []
    return (await sourceRows(agencyId, rowId)).map<Source>((s) => ({
      id: s.externalId, // STABLE provider id — never the label
      connectionId: id,
      label: s.label || s.externalId,
      subscription: s.subscription,
      health: s.revokedAt ? 'revoked' : 'ok',
    }))
  },

  async options(agencyId, id, optionSource): Promise<ConnectionOption[]> {
    // One declared option source. An unknown one yields nothing rather than
    // guessing what the caller meant (Law 3).
    if (optionSource !== 'event_types') return []
    const sources = await calendlyProvider.listSources(agencyId, id)
    return sources.map((s) => ({ id: s.id, label: s.label }))
  },

  /**
   * Calendly signs with an HMAC over `t=<timestamp>,v1=<signature>`. Compared
   * in constant time; a malformed or absent header is a rejection, never a
   * pass. The secret is per-connection, so a leak is contained to one agency.
   */
  verifyWebhook({ headers, body }) {
    const header = headers['calendly-webhook-signature'] ?? headers['Calendly-Webhook-Signature'] ?? ''
    const secret = headers['x-connection-secret'] ?? ''
    if (!header || !secret) return false
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const [k, v] = p.split('=')
        return [k?.trim(), v?.trim()]
      }),
    ) as Record<string, string>
    if (!parts.t || !parts.v1) return false
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(parts.v1)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  },

  /**
   * Provider payload → engine occurrence, with every value translated into the
   * CATALOG field keys `appointment.booked` declares. A payload we do not
   * handle returns null; nothing throws.
   */
  mapEvent(payload) {
    const body = payload as CalendlyPayload | null
    if (!body || body.event !== BOOKING_CREATED) return null

    const invitee = body.payload
    const scheduled = invitee?.scheduled_event
    const occurrenceUri = invitee?.uri ?? scheduled?.uri
    const startTime = scheduled?.start_time
    if (!occurrenceUri || !startTime) return null

    const startsAt = new Date(startTime)
    if (Number.isNaN(startsAt.getTime())) return null

    return {
      eventKey: 'appointment.booked',
      occurrenceKey: `appointment:${occurrenceUri}`,
      occurredAt: new Date(),
      fields: {
        startsAt,
        appointmentName: scheduled?.name ?? '',
        inviteeEmail: invitee?.email ?? null,
      },
      subject: { email: invitee?.email ?? null, phone: invitee?.text_reminder_number ?? null },
    }
  },

  /**
   * Law 2 — exactly one Lead, resolved before the engine. Email first (the
   * identity Calendly always has), then phone. Agency-scoped throughout: a
   * booking can never resolve to another business's lead. Ambiguity resolves
   * to the oldest match rather than guessing between two.
   */
  async resolveSubject(agencyId, mapped: MappedEvent) {
    const email = (mapped.subject.email ?? '').trim().toLowerCase()
    if (email) {
      const byEmail = await db('clients')
        .select('id')
        .where({ agencyId })
        .whereRaw('lower(email) = ?', [email])
        .orderBy('id')
        .first()
      if (byEmail) return Number(byEmail.id)
    }

    const phone = (mapped.subject.phone ?? '').replace(/\D/g, '')
    if (phone.length >= 7) {
      const byPhone = await db('clients')
        .select('id')
        .where({ agencyId })
        .whereRaw("regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE ?", [`%${phone.slice(-9)}`])
        .orderBy('id')
        .first()
      if (byPhone) return Number(byPhone.id)
    }

    return null
  },
}
