import 'server-only'
import { connectionUsage } from '@/db/automations/connectionUsage'
import { listIntegrations, listSelectableEvents } from '../catalog/registry'
import type { IntegrationDefinition } from '../catalog/types'
import type { ConnectionHealth, SourceSubscriptionState } from '../catalog/vocabularies'
import { listAllConnections, listSourcesFor } from './registry'

/**
 * EVERYTHING THE CONNECTIONS PAGE RENDERS, assembled generically.
 *
 * The page iterates `listIntegrations()` and draws whatever this returns. It
 * never asks "which integration is this?" — which is why a brand-new connector
 * appears on the page the moment it is registered, with no page edit.
 *
 * Two deliberate choices worth stating:
 *
 *  · The DESCRIPTION is derived, not authored. `IntegrationDefinition` has no
 *    description field (frozen §3.1) and adding one would be a contract change,
 *    so the page explains an integration by the EVENTS its capabilities unlock.
 *    That is more honest than a marketing line: it says exactly what connecting
 *    buys you, and it can never drift from what the catalog actually offers.
 *
 *  · LAST ACTIVITY is engine truth, not a provider ping. No connector exposes a
 *    "last webhook" timestamp and inventing one would mean a contract change,
 *    so this reports when an automation bound to the connection last did
 *    something. A connection with no automations reports null, and the UI says
 *    so rather than implying silence means failure.
 */

export type SourceView = {
  id: string
  label: string
  subscription: SourceSubscriptionState
  health: ConnectionHealth
}

export type ConnectionView = {
  id: string
  displayName: string
  health: ConnectionHealth
  sources: SourceView[]
  automations: number
  lastActivityAt: string | null
}

export type IntegrationView = {
  integration: IntegrationDefinition
  /** Catalog events this integration's capabilities unlock — the description. */
  unlocks: { key: string; title: string }[]
  connections: ConnectionView[]
  /** At least one connection whose health is `ok`. */
  connected: boolean
  /** A connection exists but none of them is healthy — the דורש טיפול case. */
  needsAttention: boolean
}

/** Events gated on any of this integration's capabilities. Pure catalog. */
function unlockedBy(integration: IntegrationDefinition) {
  const capabilities = new Set(integration.capabilities)
  return listSelectableEvents()
    .filter((e) => e.requirements.some((r) => r.type === 'connection' && capabilities.has(r.key)))
    .map((e) => ({ key: e.key, title: e.title }))
}

export async function integrationOverview(agencyId: number): Promise<IntegrationView[]> {
  const [connections, usage] = await Promise.all([listAllConnections(agencyId), connectionUsage(agencyId)])

  const withSources = await Promise.all(
    connections.map(async (c) => ({
      connection: c,
      sources: await listSourcesFor(agencyId, c.id),
    })),
  )

  return listIntegrations().map((integration) => {
    const mine = withSources.filter((c) => c.connection.integrationKey === integration.key)
    const views: ConnectionView[] = mine.map(({ connection, sources }) => ({
      id: connection.id,
      displayName: connection.displayName,
      health: connection.health,
      sources: sources.map((s) => ({
        id: s.id,
        label: s.label,
        subscription: s.subscription,
        health: s.health,
      })),
      automations: usage[connection.id]?.automations ?? 0,
      lastActivityAt: usage[connection.id]?.lastActivityAt ?? null,
    }))

    const connected = views.some((c) => c.health === 'ok')
    return {
      integration,
      unlocks: unlockedBy(integration),
      connections: views,
      connected,
      needsAttention: views.length > 0 && !connected,
    }
  })
}
