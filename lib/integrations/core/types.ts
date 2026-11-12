/**
 * Integration Core — the shared contracts for external providers that act on an
 * agency's behalf (SmartBee today; iCount / Morning / SUMIT are not built).
 *
 * Deliberately small: who the provider is, what it can do, how an agency's
 * connection is found, the one document operation contract, and the
 * authorization boundary (./permissions.ts). No plugin loader, no workflow
 * engine: a provider is a static entry in ./registry.ts, written and reviewed.
 */

export type IntegrationProviderId = 'smartbee'

export type IntegrationCapability = 'issue_documents'

export type IntegrationEnvironment = 'test' | 'production'

/** The legal documents a provider may issue for us. Provider-neutral names. */
export type IssuedDocumentKind = 'invoice' | 'receipt' | 'invoice_receipt'

/** The issuer's tax status, as recorded on the connection. Decides which kinds are allowed. */
export type IssuerBusinessType = 'exempt' | 'authorized' | 'company'

/**
 * One agency's connection to one provider, as the server sees it. `secret` is
 * the provider's per-business credential, decrypted: it never leaves the server,
 * never reaches the model, and is never logged.
 */
export type IntegrationConnection = {
  id: number
  provider: IntegrationProviderId
  agencyId: number
  ownerUserId: number
  environment: IntegrationEnvironment
  businessType: IssuerBusinessType
  status: 'active' | 'invalid' | 'disconnected'
  secret: string
}

export type ProviderDefinition = {
  id: IntegrationProviderId
  label: string
  capabilities: readonly IntegrationCapability[]
  documentKinds: readonly IssuedDocumentKind[]
  /** The deploy-time allowlist. Never `all`: a provider is opened agency by agency. */
  isAgencyAllowed: (agencyId: number) => boolean
  /** Production stays closed until someone turns this provider's production switch on. */
  productionEnabled: () => boolean
  /** The agency's stored connection, or null. Reads by agency id only. */
  loadConnection: (agencyId: number) => Promise<IntegrationConnection | null>
}

/** A document the provider has CONFIRMED it created. Nothing else is ever reported as issued. */
export type IssuedDocument = {
  providerDocumentId: string
  number: string
  allocationNumber: string | null
  originalUrl: string | null
  copyUrl: string | null
}

/**
 * Submitting a document. Three outcomes and no fourth:
 *   accepted — the provider holds the request (`providerRef` is what we poll by);
 *   rejected — definitely not created; a new attempt needs a NEW idempotency key;
 *   retry    — not created OR not known: re-send with the SAME idempotency key.
 */
export type DocumentSubmitOutcome =
  | { kind: 'accepted'; providerRef: string; duplicate: boolean }
  | { kind: 'rejected'; reason: string; code: number | null; details: Record<string, unknown> | null }
  | { kind: 'retry'; reason: string; code: number | null }

/** Asking about a submitted document. `created` is the only success. */
export type DocumentPollOutcome =
  | { kind: 'processing' }
  | { kind: 'created'; document: IssuedDocument }
  | { kind: 'draft'; draftId: string | null }
  | { kind: 'failed'; reason: string; code: number | null; details: Record<string, unknown> | null }
  | { kind: 'retry'; reason: string; code: number | null }
