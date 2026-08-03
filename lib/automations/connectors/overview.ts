import 'server-only'
import { connectionUsage } from '@/db/automations/connectionUsage'
import { deliveryFacts } from '@/db/automations/connectionDelivery'
import { applyCustomLabels } from '@/db/automations/sourceLabels'
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
 *  · LAST ACTIVITY is engine truth, not a provider ping — when an automation
 *    bound to the connection last did something.
 *
 *  · LAST EVENT (C3) is delivery truth — when a signed payload last arrived.
 *    They are different questions and a business setting a webhook up needs the
 *    second one: "connected but nothing has ever arrived" and "connected and
 *    receiving" look identical without it, and a mistyped URL reads as success.
 *    A connector whose rows live in its own table simply reports `null`, and
 *    the UI says "not reported" rather than "never received".
 */

export type SourceView = {
  id: string
  label: string
  subscription: SourceSubscriptionState
  health: ConnectionHealth
}

/**
 * What the business actually wants to know, in their terms. Derived — never
 * stored — so it can never disagree with the facts it is derived from.
 */
export type DeliveryState =
  /** Not healthy. Whatever else is true, this is what to fix first. */
  | 'disconnected'
  /** Healthy, and a signed payload has never arrived. The setup-in-progress state. */
  | 'never_received'
  /** Healthy and receiving. */
  | 'receiving'
  /** Healthy, but this connector does not report deliveries. */
  | 'unknown'

export type ConnectionView = {
  id: string
  displayName: string
  health: ConnectionHealth
  sources: SourceView[]
  automations: number
  lastActivityAt: string | null
  /** When a signed payload last arrived. Null = never, or not reported. */
  lastEventAt: string | null
  eventCount: number
  delivery: DeliveryState
  /** Whether the connector reports deliveries at all. */
  reportsDelivery: boolean
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

function deliveryStateOf(health: ConnectionHealth, reports: boolean, count: number): DeliveryState {
  if (health !== 'ok') return 'disconnected'
  if (!reports) return 'unknown'
  return count > 0 ? 'receiving' : 'never_received'
}

export async function integrationOverview(agencyId: number): Promise<IntegrationView[]> {
  const [connections, usage, delivery] = await Promise.all([
    listAllConnections(agencyId),
    connectionUsage(agencyId),
    deliveryFacts(agencyId),
  ])

  const withSources = await Promise.all(
    connections.map(async (c) => ({
      connection: c,
      // The names the BUSINESS gave its sources, not the provider's.
      sources: await applyCustomLabels(agencyId, c.id, await listSourcesFor(agencyId, c.id)),
    })),
  )

  return listIntegrations().map((integration) => {
    const mine = withSources.filter((c) => c.connection.integrationKey === integration.key)
    const views: ConnectionView[] = mine.map(({ connection, sources }) => {
      const facts = delivery[connection.id]
      const reportsDelivery = facts !== undefined
      return {
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
        lastEventAt: facts?.lastEventAt ?? null,
        eventCount: facts?.eventCount ?? 0,
        delivery: deliveryStateOf(connection.health, reportsDelivery, facts?.eventCount ?? 0),
        reportsDelivery,
      }
    })

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
