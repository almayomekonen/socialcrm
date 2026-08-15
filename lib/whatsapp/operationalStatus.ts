import { db } from '@/config/db'
import {
  probeAppSubscribed,
  probePhoneStatus,
  type PhoneStatusProbe,
  type SubscribedAppsProbe,
} from '@/lib/whatsapp/registration'

/**
 * Truthful WhatsApp connection health for the settings UI.
 *
 * A `whatsapp_connections` row is not enough. Inbound for the agency is not
 * enough. Operational only when THIS phone is inbound-ready AND outbound-ready
 * AND there is no active account restriction.
 *
 * Priority (first wins): disconnected → token → webhook → restricted →
 * registration_pending → unknown → inbound_only → operational.
 */

export type WhatsappHealthPrimary =
  | 'disconnected'
  | 'unknown'
  | 'token'
  | 'webhook'
  | 'registration_pending'
  | 'restricted'
  | 'inbound_only'
  | 'operational'

export type WhatsappHealth = {
  primary: WhatsappHealthPrimary
  inbound: 'ready' | 'not_ready' | 'unknown'
  outbound: 'ready' | 'not_ready' | 'restricted' | 'unknown'
}

export type WaConnectionRow = {
  phone_number_id: string
  access_token: string
  waba_id: string | null
}

export type WhatsappHealthDeps = {
  hasInboundForPhone: (agencyId: number, phoneNumberId: string) => Promise<boolean>
  hasAccountFailure: (agencyId: number, phoneNumberId: string) => Promise<boolean>
  probePhone: (phoneNumberId: string, accessToken: string) => Promise<PhoneStatusProbe>
  probeSubscribed: (wabaId: string, accessToken: string) => Promise<SubscribedAppsProbe>
}

const CONNECTED = 'CONNECTED'

export async function queryInboundForPhone(agencyId: number, phoneNumberId: string): Promise<boolean> {
  try {
    const row = await db('inbox_messages as m')
      .join('inbox_conversations as c', 'c.id', 'm.conversationId')
      .where('m.agencyId', agencyId)
      .where('m.direction', 'inbound')
      .where('c.businessPhoneNumberId', phoneNumberId)
      .first('m.id')
    return Boolean(row)
  } catch {
    return false
  }
}

/**
 * An account restriction stays active until a later successful outbound on
 * the same phone. A later generic/window/recipient failure or inbound must
 * not clear it.
 */
export function accountRestrictionIsActive(args: {
  latestAccountFailureAt: Date | string | null
  latestSuccessfulOutboundAt: Date | string | null
}): boolean {
  if (!args.latestAccountFailureAt) return false
  if (!args.latestSuccessfulOutboundAt) return true
  return new Date(args.latestAccountFailureAt).getTime() >= new Date(args.latestSuccessfulOutboundAt).getTime()
}

export async function queryAccountFailureForPhone(agencyId: number, phoneNumberId: string): Promise<boolean> {
  try {
    const row = await db('inbox_messages as m')
      .join('inbox_conversations as c', 'c.id', 'm.conversationId')
      .where('m.agencyId', agencyId)
      .where('m.direction', 'outbound')
      .where('m.errorReason', 'account')
      .where('c.businessPhoneNumberId', phoneNumberId)
      .whereNotExists(function () {
        this.select(db.raw('1'))
          .from('inbox_messages as later')
          .join('inbox_conversations as later_c', 'later_c.id', 'later.conversationId')
          .whereRaw('later."agencyId" = m."agencyId"')
          .andWhere('later.direction', 'outbound')
          .whereIn('later.status', ['sent', 'delivered', 'read'])
          .andWhereRaw('later_c."businessPhoneNumberId" = c."businessPhoneNumberId"')
          .andWhereRaw('later."createdAt" > m."createdAt"')
      })
      .orderBy('m.createdAt', 'desc')
      .first('m.id')
    return Boolean(row)
  } catch {
    return false
  }
}

const defaultDeps: WhatsappHealthDeps = {
  hasInboundForPhone: queryInboundForPhone,
  hasAccountFailure: queryAccountFailureForPhone,
  probePhone: probePhoneStatus,
  probeSubscribed: probeAppSubscribed,
}

function tokenHealth(inbound: WhatsappHealth['inbound']): WhatsappHealth {
  return { primary: 'token', inbound, outbound: 'unknown' }
}

export async function resolveWhatsappHealth(
  conn: WaConnectionRow | null | undefined,
  agencyId: number,
  injected: WhatsappHealthDeps = defaultDeps,
): Promise<WhatsappHealth> {
  if (!conn) {
    return { primary: 'disconnected', inbound: 'not_ready', outbound: 'not_ready' }
  }

  const [inboundHit, accountFail, phoneProbe, subProbe] = await Promise.all([
    injected.hasInboundForPhone(agencyId, conn.phone_number_id),
    injected.hasAccountFailure(agencyId, conn.phone_number_id),
    injected.probePhone(conn.phone_number_id, conn.access_token),
    conn.waba_id ? injected.probeSubscribed(conn.waba_id, conn.access_token) : Promise.resolve(null),
  ])

  if (phoneProbe.ok === false && phoneProbe.kind === 'token') {
    return tokenHealth(inboundHit ? 'ready' : 'unknown')
  }
  if (subProbe && subProbe.ok === false && subProbe.kind === 'token') {
    return tokenHealth(inboundHit ? 'ready' : 'unknown')
  }

  const subscribed = subProbe?.ok === true && subProbe.subscribed
  const inboundReady = subscribed || inboundHit
  const inbound: WhatsappHealth['inbound'] = inboundReady
    ? 'ready'
    : subProbe !== null && subProbe.ok === false
      ? 'unknown'
      : 'not_ready'

  if (conn.waba_id && subProbe?.ok === true && !subProbe.subscribed && !inboundHit) {
    return { primary: 'webhook', inbound: 'not_ready', outbound: outboundFromPhone(phoneProbe, accountFail) }
  }

  if (accountFail) {
    return { primary: 'restricted', inbound, outbound: 'restricted' }
  }

  if (phoneProbe.ok && phoneProbe.status !== CONNECTED) {
    return { primary: 'registration_pending', inbound, outbound: 'not_ready' }
  }

  if (!phoneProbe.ok) {
    return { primary: 'unknown', inbound, outbound: 'unknown' }
  }

  const outboundReady = phoneProbe.status === CONNECTED && !accountFail
  if (inboundReady && outboundReady) {
    return { primary: 'operational', inbound: 'ready', outbound: 'ready' }
  }
  if (inboundReady) {
    return { primary: 'inbound_only', inbound: 'ready', outbound: 'not_ready' }
  }
  return { primary: 'unknown', inbound, outbound: outboundReady ? 'ready' : 'not_ready' }
}

function outboundFromPhone(
  phoneProbe: PhoneStatusProbe,
  accountFail: boolean,
): WhatsappHealth['outbound'] {
  if (accountFail) return 'restricted'
  if (!phoneProbe.ok) return 'unknown'
  return phoneProbe.status === CONNECTED ? 'ready' : 'not_ready'
}
