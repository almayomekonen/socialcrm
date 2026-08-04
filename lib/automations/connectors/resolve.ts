import type { Connection, ConnectionOption, Source } from '../catalog/types'
import { isWebhookConnector, type ConnectionProvider, type WebhookConnector } from './types'

/**
 * The Connection layer's LOGIC, separated from the list of installed
 * providers.
 *
 * Everything here is pure with respect to integrations: it is handed a set of
 * providers and answers generically. `registry.ts` is nothing but this module
 * plus the static provider list — which is what lets a brand-new integration
 * be proven, in a test, to need exactly one line of registration and no logic
 * anywhere.
 *
 * A provider that throws is treated as "answered nothing". A failure to reach
 * an integration must never take down the Builder — but it must also never be
 * mistaken for health: `resolveCapabilities` only counts `health === 'ok'`.
 */

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)

export function providerFor(providers: readonly ConnectionProvider[], integrationKey: string): ConnectionProvider | null {
  return providers.find((p) => p.integrationKey === integrationKey) ?? null
}

/**
 * A connection id carries its owner: `<integrationKey>:<stable-id>`. Routing
 * on the id means no caller ever has to know which integration it holds.
 */
export function providerForConnection(providers: readonly ConnectionProvider[], connectionId: string): ConnectionProvider | null {
  const [integrationKey] = connectionId.split(':')
  return providerFor(providers, integrationKey ?? '')
}

export async function listAllConnections(providers: readonly ConnectionProvider[], agencyId: number): Promise<Connection[]> {
  const all = await Promise.all(providers.map((p) => safe(p.listConnections(agencyId), [])))
  return all.flat()
}

export async function listSourcesFor(
  providers: readonly ConnectionProvider[],
  agencyId: number,
  connectionId: string,
): Promise<Source[]> {
  const provider = providerForConnection(providers, connectionId)
  if (!provider) return []
  return safe(provider.listSources(agencyId, connectionId), [])
}

export async function optionsFor(
  providers: readonly ConnectionProvider[],
  agencyId: number,
  connectionId: string,
  optionSource: string,
): Promise<ConnectionOption[]> {
  const provider = providerForConnection(providers, connectionId)
  if (!provider) return []
  return safe(provider.options(agencyId, connectionId, optionSource), [])
}

/**
 * Capability keys the agency currently satisfies — the input to the
 * Requirement Runtime. Only a HEALTHY connection grants its capability: a
 * revoked or unverified connection must not make an event look runnable.
 */
export async function resolveCapabilities(providers: readonly ConnectionProvider[], agencyId: number): Promise<Set<string>> {
  const capabilities = new Set<string>()
  for (const provider of providers) {
    const connections = await safe(provider.listConnections(agencyId), [] as Connection[])
    if (connections.some((c) => c.health === 'ok')) {
      for (const key of provider.capabilities) capabilities.add(key)
    }
  }
  return capabilities
}

/**
 * The HEALTHY connections that grant a capability.
 *
 * An action declares the capability it needs; a provider declares the
 * capabilities it grants. Intersecting the two answers "which connection can
 * serve this action's option list" without any caller naming an integration —
 * which is what lets the Builder populate a template picker while remaining, by
 * Law 1, integration-unaware.
 *
 * Only `health === 'ok'`, for the same reason `resolveCapabilities` insists on
 * it: options read from a revoked connection would look available and fail.
 */
export async function connectionsForCapability(
  providers: readonly ConnectionProvider[],
  agencyId: number,
  capability: string,
): Promise<Connection[]> {
  const granting = providers.filter((p) => p.capabilities.includes(capability))
  const all = await Promise.all(granting.map((p) => safe(p.listConnections(agencyId), [] as Connection[])))
  return all.flat().filter((c) => c.health === 'ok')
}

/** Health of one bound connection; `null` when it no longer exists at all. */
export async function connectionHealth(
  providers: readonly ConnectionProvider[],
  agencyId: number,
  connectionId: string,
): Promise<Connection['health'] | null> {
  const provider = providerForConnection(providers, connectionId)
  if (!provider) return null
  const found = (await safe(provider.listConnections(agencyId), [] as Connection[])).find((c) => c.id === connectionId)
  return found?.health ?? null
}

/**
 * The connector able to receive webhooks for an integration. A provider that
 * does not implement the full inbound half is not one — the route rejects it
 * rather than half-processing a payload.
 */
export function webhookConnectorFor(providers: readonly ConnectionProvider[], integrationKey: string): WebhookConnector | null {
  const provider = providerFor(providers, integrationKey)
  return isWebhookConnector(provider) ? provider : null
}

/**
 * A bound connection is a problem when it is gone or not healthy. This is the
 * single definition behind the Builder's "דורש טיפול" — no silent failures.
 */
export const isConnectionProblem = (health: Connection['health'] | null) => health !== 'ok'
