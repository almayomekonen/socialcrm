import { db } from '@/config/db'
import { RSVP_REQUEST_KIND, WEDDING_AGENCY_ID } from '@/lib/weddingRsvp/config'
import { createLeadForIntegration, integrationUserId } from '@/lib/weddingRsvp/integration'
import { sendWeddingRsvpRequest } from '@/lib/weddingRsvp/rsvpRequest'

/**
 * Wedding Manager integration — the RSVP-request half. Called only after
 * `verifyIntegrationRequest` accepted an HMAC-signed request AND the RSVP send
 * switch is on. Purpose-specific: the caller names a guest, never a template,
 * body or Meta payload.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const E164 = /^[1-9]\d{7,14}$/
const NAME_MAX = 80
const MAX_ITEMS = 200

export type RsvpRequestInput = { requestId: string; phone: string; firstName: string; lastName: string }

export type IntegrationRsvpResult =
  | { httpStatus: 200; body: { accepted: true; wamid: string; status: 'sent' | 'delivered' | 'read'; replay: boolean } }
  | { httpStatus: 400 | 409 | 422 | 503; body: { accepted: false; error: string; code?: string } }

export function parseRsvpRequestInput(body: unknown): RsvpRequestInput | null {
  const b = (body ?? {}) as Record<string, unknown>
  const requestId = typeof b.requestId === 'string' ? b.requestId : ''
  const phone = typeof b.phone === 'string' ? b.phone : ''
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : ''
  const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : ''
  if (!UUID.test(requestId) || !E164.test(phone) || firstName.length > NAME_MAX || lastName.length > NAME_MAX) return null
  return { requestId: requestId.toLowerCase(), phone, firstName, lastName }
}

async function findByRequestId(requestId: string) {
  return db('inbox_messages')
    .where({ agencyId: WEDDING_AGENCY_ID, direction: 'outbound' })
    .whereRaw(`metadata->>'weddingRsvpRequestId' = ?`, [requestId])
    .orderBy('id', 'desc')
    .first('externalId', 'status')
}

function replay(row: { externalId: string | null; status: string }): IntegrationRsvpResult {
  if (row.status === 'failed' || !row.externalId) return { httpStatus: 409, body: { accepted: false, error: 'already-failed' } }
  const status = row.status === 'delivered' || row.status === 'read' ? row.status : 'sent'
  return { httpStatus: 200, body: { accepted: true, wamid: row.externalId, status, replay: true } }
}

/** Send ONE RSVP request. The same requestId never sends twice — a repeat returns the original wamid. */
export async function sendRsvpRequestViaIntegration(input: RsvpRequestInput): Promise<IntegrationRsvpResult> {
  const prior = await findByRequestId(input.requestId)
  if (prior) return replay(prior)

  const userId = await integrationUserId()
  if (!userId) return { httpStatus: 503, body: { accepted: false, error: 'integration-user-not-configured' } }

  const result = await sendWeddingRsvpRequest({
    agencyId: WEDDING_AGENCY_ID,
    userId,
    phone: input.phone,
    firstName: input.firstName,
    lastName: input.lastName,
    correlationId: input.requestId,
    createLead: createLeadForIntegration,
  })
  if (!('error' in result)) return { httpStatus: 200, body: { accepted: true, wamid: result.wamid, status: 'sent', replay: false } }
  if (result.error === 'already-requested') {
    const won = await findByRequestId(input.requestId)
    if (won) return replay(won)
  }
  return { httpStatus: 422, body: { accepted: false, error: result.error, ...(result.code ? { code: result.code } : {}) } }
}

// ---------------------------------------------------------------------------
// Delivery status of RSVP requests (read-only; part of invitation-statuses)
// ---------------------------------------------------------------------------

export function parseRsvpRequestQuery(body: unknown): Array<{ requestId: string; externalMessageId: string | null }> {
  const list = Array.isArray((body as { rsvpRequests?: unknown })?.rsvpRequests) ? ((body as { rsvpRequests: unknown[] }).rsvpRequests) : []
  return list
    .slice(0, MAX_ITEMS)
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.requestId === 'string' && UUID.test(i.requestId))
    .map((i) => ({
      requestId: String(i.requestId).toLowerCase(),
      externalMessageId: typeof i.externalMessageId === 'string' && i.externalMessageId.startsWith('wamid.') ? i.externalMessageId : null,
    }))
}

type Delivery = { deliveredAt?: string; readAt?: string; failedAt?: string; errorCode?: number | string }

export async function rsvpRequestStatuses(requests: Array<{ requestId: string; externalMessageId: string | null }>) {
  if (!requests.length) return []
  const ids = requests.map((r) => r.requestId)
  const rows = await db('inbox_messages')
    .where({ agencyId: WEDDING_AGENCY_ID, direction: 'outbound' })
    .whereRaw(`metadata->>'kind' = ?`, [RSVP_REQUEST_KIND])
    .whereRaw(`metadata->>'weddingRsvpRequestId' = ANY(?)`, [ids])
    .select('externalId', 'status', 'createdAt', db.raw(`metadata->>'weddingRsvpRequestId' AS correlation`), db.raw(`metadata->'delivery' AS delivery`))
  return requests.map((req) => {
    const row = rows.find((r) => r.correlation === req.requestId)
    if (!row) return { requestId: req.requestId, externalMessageId: req.externalMessageId, status: null, errorCode: null, sentAt: null, deliveredAt: null, readAt: null, failedAt: null }
    const d = (row.delivery ?? {}) as Delivery
    return {
      requestId: req.requestId,
      externalMessageId: row.externalId ?? null,
      status: (['sent', 'delivered', 'read', 'failed'].includes(row.status) ? row.status : 'sent') as 'sent' | 'delivered' | 'read' | 'failed',
      errorCode: d.errorCode != null ? String(d.errorCode) : null,
      sentAt: new Date(row.createdAt).toISOString(),
      deliveredAt: d.deliveredAt ?? null,
      readAt: d.readAt ?? null,
      failedAt: d.failedAt ?? null,
    }
  })
}
