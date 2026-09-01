import type { Knex } from 'knex'
import { db } from '@/config/db'
import { resolveWhatsappAccessToken } from '@/lib/whatsapp/connectionToken'

export async function getWhatsappConnectionForAgency(agencyId: number) {
  const row = await db('whatsapp_connections').where({ agency_id: agencyId }).first()
  if (!row) return row
  return { ...row, access_token: resolveWhatsappAccessToken(row.access_token) }
}

export async function deleteWhatsappConnectionsForAgency(agencyId: number) {
  return db('whatsapp_connections').where({ agency_id: agencyId }).delete()
}

/**
 * Non-secret shape of a connection, read immediately BEFORE it is deleted.
 *
 * Deliberately never selects `access_token` or `phone_number_id`: this exists to
 * be attached to an analytics event, and a credential (or a customer's number)
 * must never reach `analytics_events.props`. Everything here is either an
 * internal id or a low-cardinality label safe to keep forever.
 */
export type WhatsappConnectionAudit = {
  id: number
  waba_id: string | null
  onboarding_type: string | null
  health_status: string | null
  created_at: Date | null
}

export async function getWhatsappConnectionAuditForAgency(agencyId: number): Promise<WhatsappConnectionAudit | undefined> {
  return db('whatsapp_connections')
    .where({ agency_id: agencyId })
    .first('id', 'waba_id', 'onboarding_type', 'health_status', 'created_at')
}

export async function getWhatsappConnectionState(agencyId: number): Promise<{ connected: boolean }> {
  const connection = await getWhatsappConnectionForAgency(agencyId)
  return { connected: !!connection }
}

export type WabaBackfillRow = { id: number; phone_number_id: string; access_token: string }

export async function listConnectionsMissingWaba(conn: Knex = db): Promise<WabaBackfillRow[]> {
  return conn('whatsapp_connections').whereNull('waba_id').select('id', 'phone_number_id', 'access_token')
}

export async function setConnectionWabaId(id: number, wabaId: string, conn: Knex = db): Promise<number> {
  return conn('whatsapp_connections').where({ id }).whereNull('waba_id').update({ waba_id: wabaId })
}
