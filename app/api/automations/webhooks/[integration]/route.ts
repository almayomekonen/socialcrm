import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { webhookConnectorFor } from '@/lib/automations/connectors/registry'
import { ingestWebhookWith, type IngestRejection } from '@/lib/automations/connectors/ingest'
import { emitAutomationEvent } from '@/lib/automations/emit'

/**
 * THE generic connector webhook endpoint.
 *
 * One route for every integration, forever. `[integration]` selects a
 * connector from the registry; everything after that is the connector's own
 * contract. This file names no provider, reads no provider field, and contains
 * no branch on which integration is calling — adding the next connector adds
 * nothing here.
 *
 * The agency is identified by the connection id in the path query, not by
 * anything in the payload: a webhook body is attacker-controlled, and letting
 * it choose whose leads to touch would be a cross-tenant hole. The
 * per-connection secret is loaded from that row and handed to the connector's
 * own signature check.
 */

const LOG = '[automations][webhook]'

/** Rejections that are the caller's fault get 4xx; the rest are quiet 200s. */
const STATUS: Record<IngestRejection, number> = {
  invalid_signature: 401,
  unreadable_payload: 400,
  // Not errors: the provider sent something we do not act on, or the booking
  // is for someone who is not a lead. Returning 200 stops the provider
  // retrying forever over a decision we already made.
  not_actionable: 200,
  event_undescribed: 200,
  event_unbridged: 200,
  subject_unresolved: 200,
}

export async function POST(req: Request, ctx: { params: Promise<{ integration: string }> }) {
  const { integration } = await ctx.params
  const connector = webhookConnectorFor(integration)
  if (!connector) {
    console.warn(LOG, { rejected: 'unknown_integration', integration })
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const url = new URL(req.url)
  const connectionId = url.searchParams.get('c') ?? ''
  const rowId = Number(connectionId.split(':')[1])
  if (!Number.isInteger(rowId)) {
    console.warn(LOG, { rejected: 'unknown_connection', integration })
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const row = (await db('automation_connections')
    .select('id', 'agencyId', 'webhookSecret', 'revokedAt')
    .where({ id: rowId, integrationKey: integration })
    .first()) as { id: number; agencyId: number; webhookSecret: string | null; revokedAt: Date | null } | undefined

  if (!row || row.revokedAt) {
    console.warn(LOG, { rejected: 'unknown_connection', integration, connectionId })
    return NextResponse.json({ ok: false }, { status: 404 })
  }

  const body = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => (headers[key.toLowerCase()] = value))
  // The connection's own secret, never a global one: a leak is contained to
  // one agency's connection and is revoked by re-authorising it.
  headers['x-connection-secret'] = row.webhookSecret ?? ''

  const outcome = await ingestWebhookWith(
    connector,
    { resolveSubject: connector.resolveSubject, emit: emitAutomationEvent },
    { agencyId: row.agencyId, headers, body },
  )

  // `'reason' in outcome` rather than `!outcome.accepted`: this repo compiles
  // with strictNullChecks off, under which boolean discriminants do not narrow.
  if ('reason' in outcome) {
    // Named, never silent — a dropped booking must be greppable.
    console.warn(LOG, { rejected: outcome.reason, integration, agencyId: row.agencyId, connectionId })
    return NextResponse.json({ ok: false, reason: outcome.reason }, { status: STATUS[outcome.reason] })
  }

  console.log(LOG, { accepted: true, integration, agencyId: row.agencyId, leadId: outcome.leadId })
  return NextResponse.json({ ok: true })
}
