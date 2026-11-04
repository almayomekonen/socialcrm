import { db } from '@/config/db'
import { COEXISTENCE_GRAPH_VERSION } from '@/lib/whatsapp/coexistence'
import { metaTraceId, storableMetaErrorText } from '@/lib/whatsapp/coexistenceEvents'

/** The two steps of a signup that can fail temporarily, and how their failures are recorded. */

const GRAPH = `https://graph.facebook.com/${COEXISTENCE_GRAPH_VERSION}`

/** Waits before the 2nd and 3rd try of a step that may have failed temporarily. */
const SUBSCRIBE_RETRY_DELAYS_MS = [500, 1500]
const SAVE_RETRY_DELAYS_MS = [500]
/** One Graph call. Without a bound, a hung call ends the function before any response can keep the token. */
export const GRAPH_CALL_TIMEOUT_MS = 6_000
/**
 * Graph codes that say "not now". They can arrive as HTTP 400 (see #80008 in
 * registration.ts), so the status alone would call them final and lose the token.
 */
const TEMPORARY_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613, 80004, 80008])

export type EventDetail = Record<string, string | number | boolean>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What a Graph failure may store: Meta's codes, trace id and cleaned text. Never the token. */
export async function graphFailureDetail(res: Response): Promise<EventDetail> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown; message?: unknown; is_transient?: unknown }
  }
  const detail: EventDetail = { metaStatus: res.status }
  if (typeof body.error?.code === 'number') detail.metaCode = body.error.code
  if (typeof body.error?.error_subcode === 'number') detail.metaSubcode = body.error.error_subcode
  if (body.error?.is_transient === true || (typeof body.error?.code === 'number' && TEMPORARY_GRAPH_CODES.has(body.error.code))) detail.metaTemporary = true
  const trace = metaTraceId(body.error?.fbtrace_id)
  if (trace) detail.metaTraceId = trace
  const message = storableMetaErrorText(body.error?.message)
  if (message) detail.metaErrorMessage = message
  return detail
}

/** The error's name only: a fetch error is not guaranteed to leave the URL out of everything it holds. */
export function errorName(e: unknown): string {
  return e instanceof Error ? e.name : 'unknown'
}

/**
 * POST subscribed_apps. Retries only a network failure or a 5xx. A 4xx is not
 * retried here, and is final unless Graph says it is temporary: a rate limit is
 * not helped by calling again now, but the token is still good later.
 */
export async function subscribeApp(wabaId: string, accessToken: string): Promise<{ ok: true } | { detail: EventDetail }> {
  let detail: EventDetail = {}
  for (let attempt = 0; attempt <= SUBSCRIBE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(SUBSCRIBE_RETRY_DELAYS_MS[attempt - 1])
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(GRAPH_CALL_TIMEOUT_MS),
      })
      if (res.ok) return { ok: true }
      detail = await graphFailureDetail(res)
      console.error('[WA EmbeddedSignup] subscribed_apps failed:', detail)
      if (res.status < 500) return { detail: detail.metaTemporary ? detail : { ...detail, permanent: true } }
    } catch (e) {
      detail = { networkError: errorName(e) }
      console.error('[WA EmbeddedSignup] subscribed_apps threw:', detail)
    }
  }
  return { detail }
}

/**
 * The conflict update only applies to this agency's own row. The earlier ownership
 * check can be out of date by the time this runs, and without the condition this
 * upsert would take the number from whichever agency saved it in between.
 */
export async function saveConnection(row: {
  user_id: number
  agency_id: number
  phone_number_id: string
  access_token: string
  waba_id: string
  onboarding_type: string
}): Promise<'saved' | 'claimed' | 'failed'> {
  const { phone_number_id: _conflictKey, ...merge } = row
  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(SAVE_RETRY_DELAYS_MS[attempt - 1])
    try {
      const rows = await db('whatsapp_connections')
        .insert(row)
        .onConflict('phone_number_id')
        .merge(merge)
        .where('whatsapp_connections.agency_id', row.agency_id)
        .returning('id')
      return rows.length > 0 ? 'saved' : 'claimed'
    } catch (err) {
      console.error('[WA EmbeddedSignup] DB upsert failed:', errorName(err))
    }
  }
  return 'failed'
}
