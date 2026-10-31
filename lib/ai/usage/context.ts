import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The business operation a provider request belongs to.
 *
 * A worker wraps ONE unit of work (an auto-response job, an analysis job, a
 * WhatsApp-assistant job, an API request) in `withAiOperation`; every provider
 * request made inside it — however deep, through runStructured or the Agent —
 * is recorded under that operation. Outside any operation a request is its own
 * operation (`operationKind` = the task kind).
 *
 * Only identifiers travel here, never content.
 */
export type AiOperation = {
  kind: string
  id: string | null
  agencyId?: number | null
  userId?: number | null
  conversationId?: number | null
  leadId?: number | null
}

const storage = new AsyncLocalStorage<AiOperation>()

export function withAiOperation<T>(op: AiOperation, fn: () => Promise<T>): Promise<T> {
  return storage.run(op, fn)
}

export function currentAiOperation(): AiOperation | undefined {
  return storage.getStore()
}
