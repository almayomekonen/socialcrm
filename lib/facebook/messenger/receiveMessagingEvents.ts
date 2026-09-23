import { db } from '@/config/db'
import { isFacebookMessengerEnabledForAgency } from '@/lib/facebook/permissions'
import { messengerEventKey, parseMessagingEvent } from '@/lib/facebook/messenger/parseMessagingEvent'
import { recordMessengerEvents, type NewMessengerEvent } from '@/db/messengerWebhookEvents'
import { describeDbError } from '@/lib/system/dbErrorInfo'

/**
 * The webhook's entire Messenger responsibility: write the delivery's messages
 * down, then return. RECEIVE → DURABLE RECORD → ACKNOWLEDGE → PROCESS, the same
 * split as WhatsApp history (lib/inbox/history/receiveHistory.ts).
 *
 * NEVER THROWS, and never hides a failed write. Exactly one outcome — `failed` —
 * means "do not acknowledge": the route answers non-2xx so Meta redelivers.
 * Everything that would produce the identical result on redelivery is
 * acknowledged instead (not a message, a Page with no connection, an agency
 * outside the Messenger rollout), because a retry loop there only risks Meta
 * disabling the subscription that Lead Ads share.
 *
 * TENANCY comes from the signed `entry.id` via facebook_pages — resolved here in
 * one query for the whole delivery and verified again by the worker.
 */

export type MessengerReceiveResult =
  | { outcome: 'none' }
  | { outcome: 'recorded'; recordedIds: number[]; duplicates: number; ignored: number }
  | { outcome: 'failed' }

type Entry = { id?: unknown; messaging?: unknown }

export async function receiveMessagingEvents(entries: unknown): Promise<MessengerReceiveResult> {
  const candidates: { pageId: string; kind: NewMessengerEvent['kind']; eventKey: string; raw: unknown }[] = []
  for (const entry of Array.isArray(entries) ? (entries as Entry[]) : []) {
    const pageId = typeof entry?.id === 'string' ? entry.id : null
    if (!pageId || !Array.isArray(entry.messaging)) continue
    for (const raw of entry.messaging) {
      const event = parseMessagingEvent(pageId, raw)
      if (event.kind === 'ignored') continue
      // Messages key on Meta's mid; receipts, postbacks, referrals and reactions
      // carry no id, so the key is derived from their content.
      const eventKey = messengerEventKey(event)
      if (!eventKey) continue
      candidates.push({ pageId, kind: event.kind, eventKey, raw })
    }
  }
  if (candidates.length === 0) return { outcome: 'none' }

  try {
    const pageIds = [...new Set(candidates.map((c) => c.pageId))]
    const rows = (await db('facebook_pages').whereIn('page_id', pageIds).select('page_id', 'agency_id')) as {
      page_id: string
      agency_id: number
    }[]
    const agencyByPage = new Map(rows.map((r) => [r.page_id, Number(r.agency_id)]))

    const events: NewMessengerEvent[] = []
    let unknownPage = 0
    let notEnabled = 0
    for (const c of candidates) {
      const agencyId = agencyByPage.get(c.pageId)
      if (agencyId === undefined) unknownPage++
      else if (!isFacebookMessengerEnabledForAgency(agencyId)) notEnabled++
      else events.push({ agencyId, pageId: c.pageId, eventKey: c.eventKey, kind: c.kind, payload: c.raw })
    }
    const ignored = candidates.length - events.length
    // Counts only. Without this line a delivery Meta made and we chose not to store
    // is indistinguishable in the logs from a delivery Meta never made.
    if (ignored > 0) console.warn('[Messenger] events acknowledged without storing', { unknownPage, notEnabled })
    if (events.length === 0) return { outcome: 'recorded', recordedIds: [], duplicates: 0, ignored }

    const { recordedIds, duplicates } = await recordMessengerEvents(events)
    return { outcome: 'recorded', recordedIds, duplicates, ignored }
  } catch (err) {
    // PII-free: SQLSTATE/constraint only.
    console.error('[Messenger] durable receipt FAILED — delivery not acknowledged', { db: describeDbError(err).summary })
    return { outcome: 'failed' }
  }
}
