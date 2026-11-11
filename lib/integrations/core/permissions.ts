import 'server-only'
import { getProvider } from './registry'
import type { IntegrationConnection, IntegrationProviderId } from './types'

/**
 * THE AUTHORIZATION BOUNDARY for every provider operation. Called by the
 * proposal, again at the button tap, and again inside the executor, so a change
 * between any two of them (allowlist edited, connection revoked, owner changed)
 * stops the operation.
 *
 * All of these must hold, and every one is read from the server, never from the
 * message, the browser or the model:
 *   1. the agency is on the provider's deploy allowlist;
 *   2. the agency has an ACTIVE stored connection (agency-scoped read);
 *   3. the acting user is that connection's owner;
 *   4. a production connection is refused unless production was explicitly enabled.
 */

export type IntegrationDenial =
  | 'agency_not_allowed'
  | 'not_connected'
  | 'connection_inactive'
  | 'not_owner'
  | 'production_disabled'

export type IntegrationAccess = { ok: true; connection: IntegrationConnection } | { ok: false; reason: IntegrationDenial }

export async function resolveIntegrationAccess(input: {
  provider: IntegrationProviderId
  agencyId: number
  userId: number
}): Promise<IntegrationAccess> {
  const provider = getProvider(input.provider)
  if (!Number.isSafeInteger(input.agencyId) || input.agencyId <= 0) return { ok: false, reason: 'agency_not_allowed' }
  if (!provider.isAgencyAllowed(input.agencyId)) return { ok: false, reason: 'agency_not_allowed' }
  const connection = await provider.loadConnection(input.agencyId)
  if (!connection || connection.agencyId !== input.agencyId) return { ok: false, reason: 'not_connected' }
  if (connection.status !== 'active') return { ok: false, reason: 'connection_inactive' }
  if (connection.ownerUserId !== input.userId) return { ok: false, reason: 'not_owner' }
  if (connection.environment === 'production' && !provider.productionEnabled()) return { ok: false, reason: 'production_disabled' }
  return { ok: true, connection }
}

/** Is this agency's capability offered at all (before any user is known)? No database read. */
export function isIntegrationOffered(provider: IntegrationProviderId, agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  return getProvider(provider).isAgencyAllowed(agencyId)
}
