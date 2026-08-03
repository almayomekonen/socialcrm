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

/**
 * What a connector produces from one provider payload: an occurrence the
 * engine can queue. `fields` is keyed by CATALOG field key — the connector
 * translates the provider's vocabulary, and nothing above it ever sees the
 * provider's shape.
 *
 * `null` from `mapEvent` means "not an occurrence we act on" — a payload type
 * we do not handle, or one we cannot trust. Never a throw, never a guess.
 */
export type MappedEvent = {
  /** A CATALOG event key. Unknown ⇒ the caller holds it inert (Law 3). */
  eventKey: string
  /** ADR-010 identity: what makes this occurrence distinct. */
  occurrenceKey: string
  occurredAt: Date
  /** Snapshot values, keyed by the catalog field keys the event declares. */
  fields: Record<string, unknown>
  /** How to find the subject Lead — the connector's Law 2 obligation. */
  subject: { email?: string | null; phone?: string | null }
}

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

  // ── Inbound half of the contract (§4 Q2) ─────────────────────────────────
  //
  // Optional because receiving webhooks is a CAPABILITY, not a formality:
  // WhatsApp's webhooks are received by the shipped system elsewhere, and
  // forcing it to stub these would be scaffolding pretending to be a contract.
  // A connector that receives webhooks implements all three, and the generic
  // route requires all three before it will accept anything.

  /** Signature / shared-secret check. False ⇒ the request is rejected. */
  verifyWebhook?(input: { headers: Record<string, string>; body: string }): boolean
  /** Provider payload → engine occurrence. `null` ⇒ nothing to do. */
  mapEvent?(payload: unknown): MappedEvent | null
  /**
   * Law 2: every event resolves to exactly ONE Lead, by the connector, before
   * the engine. `null` ⇒ the occurrence is dropped — an event that cannot
   * resolve cannot exist.
   */
  resolveSubject?(agencyId: number, mapped: MappedEvent): Promise<number | null>
}

/** A connector that can receive webhooks — all three inbound members present. */
export type WebhookConnector = ConnectionProvider &
  Required<Pick<ConnectionProvider, 'verifyWebhook' | 'mapEvent' | 'resolveSubject'>>

export function isWebhookConnector(provider: ConnectionProvider | null): provider is WebhookConnector {
  return Boolean(provider?.verifyWebhook && provider?.mapEvent && provider?.resolveSubject)
}
