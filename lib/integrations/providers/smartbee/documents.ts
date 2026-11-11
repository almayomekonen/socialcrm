import { SmartbeeAuthError, withSmartbeeAuth, type SmartbeeAuthDeps } from './auth'
import { SmartbeeConfigError } from './config'
import { SmartbeeTransportError, readEnvelope, readProblemErrors, smartbeeFetch, type SmartbeeHttpResult } from './http'
import type { DocumentPollOutcome, DocumentSubmitOutcome, IntegrationEnvironment } from '@/lib/integrations/core/types'
import type { SmartbeeCreatedResult, SmartbeeDocumentBody } from './types'

/**
 * The three SmartBee calls this integration makes, each turned into the Integration
 * Core's outcome types. Every result code is from SmartBee's guide; an
 * undocumented code is never read as success.
 *
 * CREATE (`POST /documents/create`), SmartBee answers in HTTP 200:
 *   101 queued → accepted        95 duplicate → accepted (the ORIGINAL message id)
 *   98 bad business token → rejected   99 server error → retry (same providerMsgId)
 * HTTP 400 (validation) → rejected. 401 after one re-login, 429, 5xx, timeout,
 * network → retry: either SmartBee never processed it, or we cannot know, and
 * re-sending the SAME providerMsgId is safe because SmartBee deduplicates it
 * permanently. That is the whole recovery rule.
 *
 * POLL (`GET /documents/{apiMessageId}`):
 *   1 processing   102 created   103 draft   96 validation   94 no API plan
 *   104 creation disabled   97 unknown message id (uncertain) / 99 / 199 → retry
 *
 * SEARCH (`POST /documents/search`) is used only to validate a connection:
 * 120 = the business token works, 98 = it does not. Observed on the real sandbox
 * (2026-11-11): a VALID token whose account lacks the search role answers 94
 * with `NotAuthorized: Required roles not found for action: documents/search`
 * (a wrong token still gets 98, so the token is checked first). Only that exact
 * 94 counts as "token recognized, search unavailable"; any other 94 (e.g. no API
 * plan at all) fails closed. Nothing here makes issuance depend on search, and
 * 94 is never success for create or poll.
 */

const RETRY_STATUSES = new Set([401, 408, 429, 500, 502, 503, 504])

function failureOf(err: unknown): { kind: 'retry'; reason: string; code: null } {
  if (err instanceof SmartbeeTransportError) return { kind: 'retry', reason: `transport_${err.reason}`, code: null }
  if (err instanceof SmartbeeAuthError) return { kind: 'retry', reason: `auth_${err.reason}`, code: null }
  if (err instanceof SmartbeeConfigError) return { kind: 'retry', reason: `config_${err.reason}`, code: null }
  throw err
}

async function call(env: IntegrationEnvironment, method: 'GET' | 'POST', path: string, body: unknown, deps: SmartbeeAuthDeps): Promise<SmartbeeHttpResult> {
  return withSmartbeeAuth(env, (bearer) => smartbeeFetch({ env, method, path, body, bearer, fetchImpl: deps.fetchImpl }), deps)
}

export async function createSmartbeeDocument(
  env: IntegrationEnvironment,
  body: SmartbeeDocumentBody,
  providerUserToken: string,
  deps: SmartbeeAuthDeps = {},
): Promise<DocumentSubmitOutcome> {
  let res: SmartbeeHttpResult
  try {
    res = await call(env, 'POST', '/documents/create', { ...body, providerUserToken }, deps)
  } catch (err) {
    return failureOf(err)
  }
  if (res.status === 400) return { kind: 'rejected', reason: 'validation', code: 400, details: readProblemErrors(res.body) }
  if (res.status !== 200) return { kind: 'retry', reason: RETRY_STATUSES.has(res.status) ? `http_${res.status}` : `http_unexpected_${res.status}`, code: null }

  const env_ = readEnvelope(res.body)
  if (!env_) return { kind: 'retry', reason: 'invalid_envelope', code: null }
  const ref = typeof env_.result === 'string' && env_.result ? env_.result : null
  switch (env_.resultCodeId) {
    case 101:
      return ref ? { kind: 'accepted', providerRef: ref, duplicate: false } : { kind: 'retry', reason: 'queued_without_id', code: 101 }
    case 95:
      return ref ? { kind: 'accepted', providerRef: ref, duplicate: true } : { kind: 'retry', reason: 'duplicate_without_id', code: 95 }
    case 98:
      return { kind: 'rejected', reason: 'invalid_provider_token', code: 98, details: null }
    case 99:
      return { kind: 'retry', reason: 'server_error', code: 99 }
    default:
      return { kind: 'retry', reason: 'unexpected_code', code: env_.resultCodeId }
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export async function pollSmartbeeDocument(env: IntegrationEnvironment, apiMessageId: string, deps: SmartbeeAuthDeps = {}): Promise<DocumentPollOutcome> {
  let res: SmartbeeHttpResult
  try {
    res = await call(env, 'GET', `/documents/${encodeURIComponent(apiMessageId)}`, undefined, deps)
  } catch (err) {
    return failureOf(err)
  }
  if (res.status !== 200) return { kind: 'retry', reason: `http_${res.status}`, code: null }
  const e = readEnvelope(res.body)
  if (!e) return { kind: 'retry', reason: 'invalid_envelope', code: null }

  switch (e.resultCodeId) {
    case 1:
      return { kind: 'processing' }
    case 102: {
      const r = (e.result ?? {}) as SmartbeeCreatedResult
      const documentId = str(r.documentId)
      const number = r.index == null ? null : String(r.index).trim() || null
      // A 102 without its id or number is not a document we can stand behind: ask again.
      if (!documentId || !number) return { kind: 'retry', reason: 'created_without_identity', code: 102 }
      return {
        kind: 'created',
        document: {
          providerDocumentId: documentId,
          number,
          allocationNumber: str(r.taxConfirmationNumber),
          originalUrl: str(r.linkToOriginal),
          copyUrl: str(r.linkToCopy),
        },
      }
    }
    case 103:
      return { kind: 'draft', draftId: str((e.result as { draftDocumentId?: unknown } | null)?.draftDocumentId) }
    case 96:
      return { kind: 'failed', reason: 'validation', code: 96, details: e.validationErrors }
    case 94:
      return { kind: 'failed', reason: 'api_plan_unavailable', code: 94, details: e.validationErrors }
    case 104:
      return { kind: 'failed', reason: 'creation_disabled', code: 104, details: e.validationErrors }
    case 97:
      // "Unknown message id, or it belongs to another client": NOT proof that no document exists (our client
      // credentials may have changed). Asked again until the give-up, which reports the outcome as unconfirmed.
      return { kind: 'retry', reason: 'unknown_message', code: 97 }
    case 99:
    case 199:
      return { kind: 'retry', reason: 'server_error', code: e.resultCodeId }
    default:
      return { kind: 'retry', reason: 'unexpected_code', code: e.resultCodeId }
  }
}

export type ConnectionCheck =
  | { kind: 'valid' }
  /** 94 naming documents/search: the token was recognized; search itself is NOT available. */
  | { kind: 'recognized_search_unavailable' }
  | { kind: 'invalid_token' }
  | { kind: 'error'; reason: string }

/** True only for the 94 SmartBee gives a recognized token without the documents/search role. */
function searchRoleMissing(errors: Record<string, unknown> | null): boolean {
  const msg = errors?.NotAuthorized
  return typeof msg === 'string' && /required roles not found/i.test(msg) && /documents\/search/i.test(msg)
}

/** Does this business token work with our client? A one-row search; nothing is created. */
export async function checkSmartbeeConnection(env: IntegrationEnvironment, providerUserToken: string, deps: SmartbeeAuthDeps = {}): Promise<ConnectionCheck> {
  let res: SmartbeeHttpResult
  try {
    res = await call(env, 'POST', '/documents/search', { providerUserToken, page: 0, amountPerPage: 1 }, deps)
  } catch (err) {
    return { kind: 'error', reason: failureOf(err).reason }
  }
  if (res.status !== 200) return { kind: 'error', reason: `http_${res.status}` }
  const e = readEnvelope(res.body)
  if (e?.resultCodeId === 120) return { kind: 'valid' }
  if (e?.resultCodeId === 98) return { kind: 'invalid_token' }
  if (e?.resultCodeId === 94 && searchRoleMissing(e.validationErrors)) return { kind: 'recognized_search_unavailable' }
  return { kind: 'error', reason: e ? `code_${e.resultCodeId}` : 'invalid_envelope' }
}

/**
 * What the operator script says and whether it may store the connection. Pure;
 * never includes the token or any credential. 94 is reported as "recognized,
 * search unavailable", never as a working search.
 */
export function connectionVerdict(env: IntegrationEnvironment, check: ConnectionCheck): { ok: boolean; message: string } {
  switch (check.kind) {
    case 'valid':
      return { ok: true, message: `SmartBee ${env}: business token verified (search available)` }
    case 'recognized_search_unavailable':
      return {
        ok: true,
        message: `SmartBee ${env}: business token recognized (answer 94: this account has no documents/search permission). Search is NOT available; document creation and polling do not use it.`,
      }
    case 'invalid_token':
      return { ok: false, message: 'SmartBee answered 98: the business token is not valid for our client' }
    case 'error':
      return { ok: false, message: `could not verify with SmartBee (${check.reason}); nothing stored` }
  }
}
