'use server'

import { requireBasicCrmAccess, requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'
import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { baseUrl } from '@/types/vars'
import { connectionsForCapability, listAllConnections, listSourcesFor, optionsFor } from '@/lib/automations/connectors/registry'
import { listIntegrations } from '@/lib/automations/catalog/registry'
import { providerFor } from '@/lib/automations/connectors/registry'
import { applyCustomLabels, setSourceLabel } from '@/db/automations/sourceLabels'
import type { SetupGuide } from '@/lib/automations/connectors/types'
import type { Connection, ConnectionOption, Source } from '@/lib/automations/catalog/types'

/**
 * The Builder's only door to the Connection layer. Everything crossing it is
 * generic — {id, label} pairs and health states. No integration is named on
 * either side of this boundary.
 */

export type ConnectionsResult = { ok: true; connections: Connection[] } | { ok: false; reason: string }
export type OptionsResult = { ok: true; options: ConnectionOption[] } | { ok: false; reason: string }
export type SourcesResult = { ok: true; sources: Source[] } | { ok: false; reason: string }

/**
 * WRITES: provisioning, revoking, regenerating and renaming. Unchanged, and
 * still behind the paid boundary.
 */
async function guard() {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) return null
  return user
}

/**
 * READS: the four list actions below. Identical identity and admin check, no
 * entitlement check.
 *
 * Listing connections, sources and option values reads rows this agency already
 * owns; no provider is called, nothing is sent and nothing changes. They exist
 * so a customer can open an automation and understand what it does, which is
 * exactly the inspection an expired subscription should keep. Gating them meant
 * the Builder showed empty pickers and inline failures for a plan state, which
 * taught the customer nothing.
 */
async function readGuard() {
  const user = await requireBasicCrmAccess()
  if (!isAdmin(user.role)) return null
  return user
}

export async function listConnectionsAction(): Promise<ConnectionsResult> {
  const user = await readGuard()
  if (!user) return { ok: false, reason: 'forbidden' }
  return { ok: true, connections: await listAllConnections(user.agencyId) }
}

export async function listSourcesAction(connectionId: string): Promise<SourcesResult> {
  const user = await readGuard()
  if (!user) return { ok: false, reason: 'forbidden' }
  const sources = await listSourcesFor(user.agencyId, connectionId)
  return { ok: true, sources: await applyCustomLabels(user.agencyId, connectionId, sources) }
}

/** Resolves an `enum_remote` parameter's options via the declared source key. */
export async function listOptionsAction(connectionId: string, optionSource: string): Promise<OptionsResult> {
  const user = await readGuard()
  if (!user) return { ok: false, reason: 'forbidden' }
  // The Builder's picker shows the names the BUSINESS gave its sources, not
  // the provider's. Same overlay as the Connections page — one implementation.
  const sources = await applyCustomLabels(user.agencyId, connectionId, await listSourcesFor(user.agencyId, connectionId))
  const named = new Map(sources.map((s) => [s.id, s.label]))
  const options = await optionsFor(user.agencyId, connectionId, optionSource)
  return { ok: true, options: options.map((o) => ({ id: o.id, label: named.get(o.id) ?? o.label })) }
}

/**
 * An `enum_remote` parameter's options resolved by CAPABILITY rather than by a
 * connection id.
 *
 * An ACTION's options may live on a different connection than the event's — a
 * website-form event whose action sends a WhatsApp message needs the messaging
 * connection, not the website one. The Builder knows only the capability the
 * action declares, so it asks by that, and the connection is found here.
 *
 * Without this the Builder would have to identify the right connection itself,
 * which it can only do by recognising an integration — exactly what Law 1 forbids.
 */
export async function listOptionsForCapabilityAction(capability: string, optionSource: string): Promise<OptionsResult> {
  const user = await readGuard()
  if (!user) return { ok: false, reason: 'forbidden' }
  const connections = await connectionsForCapability(user.agencyId, capability)
  const connection = connections[0]
  // No healthy connection granting it ⇒ no options. Not an error: the action's
  // own requirement is what tells the customer to connect something.
  if (!connection) return { ok: true, options: [] }
  return listOptionsAction(connection.id, optionSource)
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
  revalidatePath('/settings/integrations')
  revalidatePath('/settings/automations')
  return { ok: true, connectionId, webhookUrl: webhookUrlFor(connectionId), secret }
}

/** The address a connection listens on. Derived from its id — never stored. */
const webhookUrlFor = (connectionId: string) =>
  `${baseUrl}/api/automations/webhooks/${connectionId.split(':')[0]}?c=${encodeURIComponent(connectionId)}`

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

  // Health, the events this connection unlocked, and the automations bound to
  // it all derive from the same row — so revalidating both surfaces is the
  // entire "disconnect" implementation. Nothing is recomputed by hand.
  revalidatePath('/settings/integrations')
  revalidatePath('/settings/automations')
  return { ok: updated > 0 }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

const parseConnectionId = (connectionId: string): { integrationKey: string; id: number } | null => {
  const [integrationKey, raw] = connectionId.split(':')
  const id = Number(raw)
  return integrationKey && Number.isInteger(id) ? { integrationKey, id } : null
}

/**
 * Rotate the shared secret without re-entering anything.
 *
 * The reason this exists as its own action rather than "just connect again":
 * re-provisioning asks for the site URL and reads like creating a second
 * connection, which is exactly the wrong thing to offer someone whose secret
 * has leaked and who needs to act in one click.
 */
export async function regenerateSecret(connectionId: string): Promise<ProvisionResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  const parsed = parseConnectionId(connectionId)
  if (!parsed) return { ok: false, reason: 'connection_unknown' }

  const integration = listIntegrations().find((i) => i.key === parsed.integrationKey)
  if (!integration || integration.auth !== 'api_key') return { ok: false, reason: 'wrong_auth_strategy' }

  const secret = crypto.randomBytes(32).toString('hex')
  const updated = await db('automation_connections')
    .where({ id: parsed.id, integrationKey: parsed.integrationKey, agencyId: user.agencyId })
    .update({ webhookSecret: secret, revokedAt: null, updatedAt: db.fn.now() })
  if (updated === 0) return { ok: false, reason: 'connection_unknown' }

  revalidatePath('/settings/integrations')
  revalidatePath('/settings/automations')
  return { ok: true, connectionId, webhookUrl: webhookUrlFor(connectionId), secret }
}

/**
 * The instructions for finishing a connection, and the address it listens on.
 *
 * The URL is NOT a secret — losing access to it after the first dialog closed
 * was a real dead end, so it is retrievable forever. The secret is not, and the
 * guide says so in its own words.
 */
export type SetupResult = { ok: true; guide: SetupGuide | null; webhookUrl: string } | { ok: false; reason: string }

export async function connectionSetup(connectionId: string): Promise<SetupResult> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  const parsed = parseConnectionId(connectionId)
  if (!parsed) return { ok: false, reason: 'connection_unknown' }

  const owned = await db('automation_connections')
    .select('id')
    .where({ id: parsed.id, integrationKey: parsed.integrationKey, agencyId: user.agencyId })
    .first()
  if (!owned) return { ok: false, reason: 'connection_unknown' }

  const webhookUrl = webhookUrlFor(connectionId)
  const provider = providerFor(parsed.integrationKey)
  // A connector with nothing for the customer to do returns nothing, and the
  // UI shows nothing — never an empty panel.
  return { ok: true, guide: provider?.setup?.({ webhookUrl, secret: null }) ?? null, webhookUrl }
}

/** Rename a source in the business's own words. Empty clears the override. */
export async function renameSource(
  connectionId: string,
  sourceId: string,
  label: string,
): Promise<{ ok: boolean; reason?: string }> {
  const user = await guard()
  if (!user) return { ok: false, reason: 'forbidden' }
  if (!parseConnectionId(connectionId) || !sourceId) return { ok: false, reason: 'connection_unknown' }

  await setSourceLabel(user.agencyId, connectionId, sourceId, label)
  revalidatePath('/settings/integrations')
  return { ok: true }
}
