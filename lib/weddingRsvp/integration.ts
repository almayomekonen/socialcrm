import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { getQuotaStatus } from '@/lib/quota'
import { WEDDING_AGENCY_ID, WEDDING_RSVP_ATTENDING, WEDDING_RSVP_NOT_ATTENDING } from '@/lib/weddingRsvp/config'
import { sendWeddingInvite } from '@/lib/weddingRsvp/invite'
import type { CreateInviteLead } from '@/lib/weddingRsvp/inviteRecipient'
import { RSVP_CHOICE_SQL, waSql } from '@/lib/weddingRsvp/integrationSql'

/**
 * The Wedding Manager integration — the SocialCRM side of the contract in
 * wedding-manager/docs/integration-contract.md. Every function here is called
 * only after `verifyIntegrationRequest` accepted an HMAC-signed request.
 *
 * It REUSES the proven invite service (sendWeddingInvite) — no Meta logic here —
 * and only READS inbox data to report status. Agency is fixed to the wedding
 * agency; the acting user is WEDDING_INTEGRATION_USER_ID.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const E164 = /^[1-9]\d{7,14}$/
const NAME_MAX = 80
const MAX_ITEMS = 200

// ---------------------------------------------------------------------------
// Acting user
// ---------------------------------------------------------------------------

export async function integrationUserId(): Promise<number | null> {
  const id = Number(process.env.WEDDING_INTEGRATION_USER_ID)
  if (!Number.isInteger(id) || id <= 0) return null
  const row = await db('users').where({ id, agencyId: WEDDING_AGENCY_ID }).first('id')
  return row ? id : null
}

/** No session here: the signed integration creates Leads through the system path. */
export const createLeadForIntegration: CreateInviteLead = async (input) => {
  const quota = await getQuotaStatus(input.agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit
  const lead = await insertLeadSystem({
    agencyId: input.agencyId,
    userId: input.userId,
    handlerId: input.userId,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.waId,
    idNum: null,
    lead: true,
    status: 'new',
    leadSource: 'wedding_invite',
    overQuota,
    createOrigin: 'manual',
  })
  const id = Number(lead?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

// ---------------------------------------------------------------------------
// 1. send-invitation
// ---------------------------------------------------------------------------

export type SendInvitationInput = { invitationId: string; phone: string; firstName: string; lastName: string }

export type IntegrationSendResult =
  | { httpStatus: 200; body: { accepted: true; wamid: string; status: 'sent' | 'delivered' | 'read'; replay: boolean } }
  | { httpStatus: 400 | 409 | 422 | 503; body: { accepted: false; error: string; code?: string } }

export function parseSendInput(body: unknown): SendInvitationInput | null {
  const b = (body ?? {}) as Record<string, unknown>
  const invitationId = typeof b.invitationId === 'string' ? b.invitationId : ''
  const phone = typeof b.phone === 'string' ? b.phone : ''
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : ''
  const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : ''
  if (!UUID.test(invitationId) || !E164.test(phone) || !firstName || firstName.length > NAME_MAX || lastName.length > NAME_MAX) return null
  return { invitationId: invitationId.toLowerCase(), phone, firstName, lastName }
}

async function findByCorrelation(invitationId: string) {
  return db('inbox_messages')
    .where({ agencyId: WEDDING_AGENCY_ID, direction: 'outbound' })
    .whereRaw(`metadata->>'weddingInvitationId' = ?`, [invitationId])
    .orderBy('id', 'desc')
    .first('externalId', 'status')
}

function replayResult(row: { externalId: string | null; status: string }): IntegrationSendResult {
  if (row.status === 'failed' || !row.externalId) return { httpStatus: 409, body: { accepted: false, error: 'already-failed' } }
  const status = row.status === 'delivered' || row.status === 'read' ? row.status : 'sent'
  return { httpStatus: 200, body: { accepted: true, wamid: row.externalId, status, replay: true } }
}

/**
 * Send ONE invitation. Replay-safe: the same invitationId never sends twice — a
 * repeat returns the original wamid. A different invitationId for an already-
 * invited phone is refused by the invite service itself (`already-invited`).
 */
export async function sendInvitationViaIntegration(input: SendInvitationInput): Promise<IntegrationSendResult> {
  const prior = await findByCorrelation(input.invitationId)
  if (prior) return replayResult(prior)

  const userId = await integrationUserId()
  if (!userId) return { httpStatus: 503, body: { accepted: false, error: 'integration-user-not-configured' } }

  const result = await sendWeddingInvite({
    agencyId: WEDDING_AGENCY_ID,
    userId,
    phone: input.phone,
    firstName: input.firstName,
    lastName: input.lastName,
    correlationId: input.invitationId,
    createLead: createLeadForIntegration,
  })
  // This repo's TS does not narrow on `.ok`; discriminate on the failure member's field.
  if (!('error' in result)) return { httpStatus: 200, body: { accepted: true, wamid: result.wamid, status: 'sent', replay: false } }

  // A concurrent duplicate of THIS invitation may have won the per-guest lock.
  if (result.error === 'already-invited') {
    const won = await findByCorrelation(input.invitationId)
    if (won) return replayResult(won)
  }
  return { httpStatus: 422, body: { accepted: false, error: result.error, ...(result.code ? { code: result.code } : {}) } }
}

// ---------------------------------------------------------------------------
// 2. invitation-statuses (+ RSVP)
// ---------------------------------------------------------------------------

export type StatusQuery = { invitations: Array<{ invitationId: string; externalMessageId: string | null }>; phones: string[] }

export function parseStatusQuery(body: unknown): StatusQuery | null {
  const b = (body ?? {}) as Record<string, unknown>
  const invs = Array.isArray(b.invitations) ? b.invitations : []
  const phones = Array.isArray(b.phones) ? b.phones : []
  if (invs.length > MAX_ITEMS || phones.length > MAX_ITEMS) return null
  const invitations = invs
    .map((i) => i as Record<string, unknown>)
    .filter((i) => typeof i.invitationId === 'string' && UUID.test(i.invitationId))
    .map((i) => ({
      invitationId: String(i.invitationId).toLowerCase(),
      externalMessageId: typeof i.externalMessageId === 'string' && i.externalMessageId.startsWith('wamid.') ? i.externalMessageId : null,
    }))
  return { invitations, phones: phones.filter((p): p is string => typeof p === 'string' && E164.test(p)) }
}

type Delivery = { sentAt?: string; deliveredAt?: string; readAt?: string; failedAt?: string; errorCode?: number | string }

export async function invitationStatuses(q: StatusQuery) {
  const ids = q.invitations.map((i) => i.invitationId)
  const wamids = q.invitations.map((i) => i.externalMessageId).filter((w): w is string => Boolean(w))
  const rows = ids.length || wamids.length
    ? await db('inbox_messages')
        .where({ agencyId: WEDDING_AGENCY_ID, direction: 'outbound' })
        .andWhere((w) => {
          if (ids.length) w.orWhereRaw(`metadata->>'weddingInvitationId' = ANY(?)`, [ids])
          if (wamids.length) w.orWhereIn('externalId', wamids)
        })
        .select('externalId', 'status', 'createdAt', db.raw(`metadata->>'weddingInvitationId' AS correlation`), db.raw(`metadata->'delivery' AS delivery`))
    : []

  const invitations = q.invitations.map((inv) => {
    const row = rows.find((r) => r.correlation === inv.invitationId) ?? rows.find((r) => inv.externalMessageId && r.externalId === inv.externalMessageId)
    if (!row) return { invitationId: inv.invitationId, externalMessageId: inv.externalMessageId, status: null, errorCode: null, sentAt: null, deliveredAt: null, readAt: null, failedAt: null }
    const d = (row.delivery ?? {}) as Delivery
    return {
      invitationId: inv.invitationId,
      externalMessageId: row.externalId ?? null,
      status: (['sent', 'delivered', 'read', 'failed'].includes(row.status) ? row.status : 'sent') as 'sent' | 'delivered' | 'read' | 'failed',
      errorCode: d.errorCode != null ? String(d.errorCode) : null,
      sentAt: new Date(row.createdAt).toISOString(),
      deliveredAt: d.deliveredAt ?? null,
      readAt: d.readAt ?? null,
      failedAt: d.failedAt ?? null,
    }
  })

  return { invitations, rsvp: await rsvpForPhones(q.phones) }
}

/** RSVP as it exists today: the latest wedding button tap, and the head count from the thank-you. */
async function rsvpForPhones(phones: string[]) {
  if (!phones.length) return []
  const taps = await db('inbox_messages as m')
    .join('inbox_conversations as c', 'c.id', 'm.conversationId')
    .where('m.agencyId', WEDDING_AGENCY_ID)
    .andWhere('m.direction', 'inbound')
    // Free-form buttons arrive as `interactive` (button_reply.id); template quick
    // replies as `button` (payload = our id, or the label if sent without payloads).
    .whereIn('m.type', ['interactive', 'button'])
    .whereRaw(`${RSVP_CHOICE_SQL} IN (?, ?)`, [WEDDING_RSVP_ATTENDING, WEDDING_RSVP_NOT_ATTENDING])
    .whereRaw(`${waSql('c')} = ANY(?)`, [phones])
    .select(db.raw(`${waSql('c')} AS phone`), db.raw(`${RSVP_CHOICE_SQL} AS choice`), 'm.createdAt')
    .orderBy('m.createdAt', 'asc')
  const thanks = await db('inbox_messages as m')
    .join('inbox_conversations as c', 'c.id', 'm.conversationId')
    .where('m.agencyId', WEDDING_AGENCY_ID)
    .andWhere('m.direction', 'outbound')
    .whereRaw(`m.metadata->>'source' = 'wedding_rsvp' AND m.metadata->>'step' = 'thanks'`)
    .whereRaw(`${waSql('c')} = ANY(?)`, [phones])
    .select(db.raw(`${waSql('c')} AS phone`), db.raw(`(m.metadata->>'headCount')::int AS head_count`), 'm.createdAt')
    .orderBy('m.createdAt', 'asc')

  return phones.flatMap((phone) => {
    const lastTap = taps.filter((t) => t.phone === phone).at(-1)
    if (!lastTap) return []
    const attending = lastTap.choice === WEDDING_RSVP_ATTENDING
    const count = attending ? thanks.filter((t) => t.phone === phone && new Date(t.createdAt) >= new Date(lastTap.createdAt)).at(-1) : undefined
    const updatedAt = new Date(count?.createdAt ?? lastTap.createdAt).toISOString()
    return [{ phone, rsvp: attending ? 'attending' : 'not_attending', headcount: count?.head_count ?? null, updatedAt }]
  })
}
