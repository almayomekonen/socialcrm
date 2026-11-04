import {
  EMBEDDED_SIGNUP_STEPS,
  META_ERROR_ID,
  META_SESSION_ID,
  META_SIGNUP_EVENTS,
  metaPayloadKeys,
  metaTimestamp,
  metaTraceId,
  storableMetaErrorText,
} from '@/lib/whatsapp/coexistenceEvents'
import { CONNECT_ATTEMPT_ID } from '@/lib/connections/lateCancelDetail'

const EVENTS = new Set<string>(META_SIGNUP_EVENTS)
const STEPS = new Set<string>(EMBEDDED_SIGNUP_STEPS)
const MAX_ACCOUNT_COUNT = 100

/**
 * What `whatsapp_connect_meta_event` may store, rebuilt field by field from
 * untrusted browser input. A bad field is dropped; no valid attempt id or Meta
 * event drops the record. Meta's error text is the one free-text field: it is
 * re-cleaned here, with anything resembling a phone number or email removed.
 * Pure, so `recordLeadActionEvent` stays about allowlisting.
 */
export function metaEventDetail(props: Record<string, unknown> | undefined): Record<string, string | number | boolean | string[]> | null {
  if (typeof props?.attemptId !== 'string' || !CONNECT_ATTEMPT_ID.test(props.attemptId)) return null
  if (typeof props.metaEvent !== 'string' || !EVENTS.has(props.metaEvent)) return null

  const detail: Record<string, string | number | boolean | string[]> = { attemptId: props.attemptId, metaEvent: props.metaEvent }
  detail.metaPayloadKeys = Array.isArray(props.metaPayloadKeys) ? metaPayloadKeys(props.metaPayloadKeys) : []
  if (typeof props.step === 'string' && STEPS.has(props.step)) detail.step = props.step
  if (typeof props.metaErrorId === 'string' && META_ERROR_ID.test(props.metaErrorId)) detail.metaErrorId = props.metaErrorId
  if (typeof props.metaSessionId === 'string' && META_SESSION_ID.test(props.metaSessionId)) detail.metaSessionId = props.metaSessionId
  const traceId = metaTraceId(props.metaTraceId)
  if (traceId) detail.metaTraceId = traceId
  const timestamp = metaTimestamp(props.metaTimestamp)
  if (timestamp) detail.metaTimestamp = timestamp
  const message = storableMetaErrorText(props.metaErrorMessage)
  if (message) detail.metaErrorMessage = message
  if (typeof props.isOnBizApp === 'boolean') detail.isOnBizApp = props.isOnBizApp
  const count = props.accountCount
  if (typeof count === 'number' && Number.isInteger(count) && count > 0) detail.accountCount = Math.min(count, MAX_ACCOUNT_COUNT)
  return detail
}
