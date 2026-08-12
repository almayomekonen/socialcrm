/**
 * Durable lead creation origin — stored on clients.createOrigin.
 * Used so reconcile can silence imports without leadSource heuristics.
 */

export const CLIENT_CREATE_ORIGINS = ['manual', 'facebook', 'whatsapp', 'cf7', 'import'] as const

export type ClientCreateOrigin = (typeof CLIENT_CREATE_ORIGINS)[number]

export function isClientCreateOrigin(value: unknown): value is ClientCreateOrigin {
  return typeof value === 'string' && (CLIENT_CREATE_ORIGINS as readonly string[]).includes(value)
}

/** upsertLead's emit origin collapses to durable createOrigin. */
export function createOriginForUpsert(emitOrigin: 'manual' | 'import'): ClientCreateOrigin {
  return emitOrigin === 'import' ? 'import' : 'manual'
}
