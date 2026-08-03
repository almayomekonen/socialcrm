'use server'

import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import crypto from 'node:crypto'
import { db } from '@/config/db'
import { baseUrl } from '@/types/vars'
import { listAllConnections, listSourcesFor, optionsFor } from '@/lib/automations/connectors/registry'
import { listIntegrations } from '@/lib/automations/catalog/registry'
import type { Connection, ConnectionOption, Source } from '@/lib/automations/catalog/types'

/**
 * The Builder's only door to the Connection layer. Everything crossing it is
 * generic — {id, label} pairs and health states. No integration is named on
 * either side of this boundary.
 */

export type ConnectionsResult = { ok: true; connections: Connection[] } | { ok: false; reason: string }
export type OptionsResult = { ok: true; options: ConnectionOption[] } | { ok: false; reason: string }
export type SourcesResult = { ok: true; sources: Source[] } | { ok: false; reason: string }

async function guard() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return null
  return user
}

export async function listConnectionsAction(): Promise<ConnectionsResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, connections: await listAllConnections(user.agencyId) }
}

export async function listSourcesAction(connectionId: string): Promise<SourcesResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, sources: await listSourcesFor(user.agencyId, connectionId) }
}

/** Resolves an `enum_remote` parameter's options via the declared source key. */
export async function listOptionsAction(connectionId: string, optionSource: string): Promise<OptionsResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, options: await optionsFor(user.agencyId, connectionId, optionSource) }
}

// ── Provisioning ───────────────────────────────────────────────────────────

export type ProvisionResult =
  | { ok: true; connectionId: string; webhookUrl: string; secret: string }
  | { ok: false; reason: string }

/**
 * Provision a connection for an integration whose auth strategy is `api_key`:
 * the customer configures THEIR system to call US, so all we can do is mint a
 * URL and a secret and hand them over.
 *
 * Generic by construction — the integration is looked up in the catalog and its
 * strategy decides whether this door is even open. Nothing here names a
 * provider, and an `oauth2` integration is refused rather than mis-provisioned.
 *
 * The secret is shown EXACTLY ONCE, at creation. Re-provisioning mints a new
 * one and invalidates the old, which is also how a leak is revoked.
 */
export async function provisionApiKeyConnection(input: {
  integrationKey: string
  siteUrl: string
  displayName?: string
}): Promise<ProvisionResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }

  const integration = listIntegrations().find((i) => i.key === input.integrationKey)
  if (!integration) return { ok: false, reason: 'integration_unknown' }
  if (integration.auth !== 'api_key') return { ok: false, reason: 'wrong_auth_strategy' }

  let origin: string
  try {
    origin = new URL(input.siteUrl).origin
  } catch {
    return { ok: false, reason: 'site_url_invalid' }
  }

  const secret = crypto.randomBytes(32).toString('hex')
  // Re-provisioning the SAME site updates its row, so the connection id — and
  // every automation bound to it — survives (a connector obligation, §3.2).
  const [row] = await db('automation_connections')
    .insert({
      agencyId: user.agencyId,
      integrationKey: integration.key,
      externalId: origin,
      displayName: input.displayName?.trim() || integration.title,
      webhookSecret: secret,
      ownerUserId: user.id,
      revokedAt: null,
    })
    .onConflict(['agencyId', 'integrationKey', 'externalId'])
    .merge({
      webhookSecret: secret,
      ownerUserId: user.id,
      displayName: input.displayName?.trim() || integration.title,
      revokedAt: null,
      updatedAt: db.fn.now(),
    })
    .returning('id')

  const id = Number((row as { id: number }).id ?? row)
  const connectionId = `${integration.key}:${id}`
  return {
    ok: true,
    connectionId,
    webhookUrl: `${baseUrl}/api/automations/webhooks/${integration.key}?c=${encodeURIComponent(connectionId)}`,
    secret,
  }
}

/**
 * Revoke a connection. Deliberately a soft revoke: the row stays so its
 * automations keep their binding and surface as דורש טיפול rather than
 * silently losing the connection they referenced.
 */
export async function revokeConnection(connectionId: string): Promise<{ ok: boolean }> {
  const user = await guard()
  if (!user) return { ok: false }
  const [integrationKey, raw] = connectionId.split(':')
  const id = Number(raw)
  if (!integrationKey || !Number.isInteger(id)) return { ok: false }
  const updated = await db('automation_connections')
    .where({ id, integrationKey, agencyId: user.agencyId })
    .update({ revokedAt: db.fn.now(), webhookSecret: null, updatedAt: db.fn.now() })
  return { ok: updated > 0 }
}
