import type { Connection, ConnectionOption, Source } from '../catalog/types'
import type { ConnectionProvider } from './types'
import { whatsappProvider } from './whatsapp'
import * as resolve from './resolve'

/**
 * Static connector registry — the ONLY file that knows which integrations are
 * installed.
 *
 * Adding an integration means adding one entry to PROVIDERS plus its catalog
 * rows, and nothing else, anywhere. All the logic lives in `resolve.ts`, which
 * takes the provider list as an argument; this file only binds it to the real
 * one. That split is what makes the claim testable rather than merely asserted.
 */
const PROVIDERS: readonly ConnectionProvider[] = [whatsappProvider]

export const providerFor = (integrationKey: string): ConnectionProvider | null => resolve.providerFor(PROVIDERS, integrationKey)

export const listAllConnections = (agencyId: number): Promise<Connection[]> => resolve.listAllConnections(PROVIDERS, agencyId)

export const listSourcesFor = (agencyId: number, connectionId: string): Promise<Source[]> =>
  resolve.listSourcesFor(PROVIDERS, agencyId, connectionId)

export const optionsFor = (agencyId: number, connectionId: string, optionSource: string): Promise<ConnectionOption[]> =>
  resolve.optionsFor(PROVIDERS, agencyId, connectionId, optionSource)

export const resolveCapabilities = (agencyId: number): Promise<Set<string>> => resolve.resolveCapabilities(PROVIDERS, agencyId)

export const connectionHealth = (agencyId: number, connectionId: string): Promise<Connection['health'] | null> =>
  resolve.connectionHealth(PROVIDERS, agencyId, connectionId)
