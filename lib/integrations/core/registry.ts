import 'server-only'
import { smartbeeProvider } from '../providers/smartbee/provider'
import type { IntegrationProviderId, ProviderDefinition } from './types'

/**
 * The closed set of providers. A provider id that is not here does not exist;
 * there is no dynamic registration, for the same reason the Agent's action
 * registry has none (lib/agent/actions/registry.ts).
 */
const PROVIDERS: Readonly<Record<IntegrationProviderId, ProviderDefinition>> = {
  smartbee: smartbeeProvider,
}

export function getProvider(id: IntegrationProviderId): ProviderDefinition {
  return PROVIDERS[id]
}

/**
 * Which provider, if any, issues this agency's legal documents instead of
 * SocialCRM's own billing. Used to block native issuance so one agency never has
 * two numbering sequences for the same documents.
 *
 * Either signal is enough: on the provider's allowlist, OR a stored connection
 * row in ANY status (active, invalid, disconnected). The row is the durable,
 * agency-level designation; its status says whether SmartBee can be reached
 * now, not who issues. So an env var removed, mistyped or missing in another
 * deployment environment never re-opens native issuance, and neither does a
 * revoked or broken connection. Deleting the row is the one deliberate act
 * that returns an agency to native billing (the migration makes the agency
 * itself undeletable while it exists).
 *
 * FAILS CLOSED: a read error throws, and the issuing action fails rather than
 * issuing natively. An agency never designated (no row, not allowlisted) is
 * untouched.
 */
export async function externalDocumentIssuer(agencyId: number): Promise<IntegrationProviderId | null> {
  for (const provider of Object.values(PROVIDERS)) {
    if (!provider.capabilities.includes('issue_documents')) continue
    if (provider.isAgencyAllowed(agencyId)) return provider.id
    if (await provider.loadConnection(agencyId)) return provider.id
  }
  return null
}
