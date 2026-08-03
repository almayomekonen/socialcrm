import type { Connection, ConnectionOption, Source } from '../catalog/types'

/**
 * The connector provider contract (frozen spec §4 Q2) — plugin SHAPE, not a
 * plugin runtime. Connectors are statically registered modules; nothing is
 * dynamically loaded.
 *
 * A connector is the ONLY place an integration's specifics live. It backs its
 * Connections and Sources from wherever that integration already stores them,
 * so adopting an existing integration needs no data migration.
 */
export type ConnectionProvider = {
  integrationKey: string
  /** Capability keys this integration satisfies once a healthy connection exists. */
  capabilities: readonly string[]
  listConnections(agencyId: number): Promise<Connection[]>
  listSources(agencyId: number, connectionId: string): Promise<Source[]>
  /**
   * Generic option provider for `enum_remote` parameters. The Builder passes
   * the catalog's declared `optionSource` and renders {id,label} pairs without
   * ever learning what they are.
   */
  options(agencyId: number, connectionId: string, optionSource: string): Promise<ConnectionOption[]>
}
