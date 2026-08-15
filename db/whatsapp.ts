import type { Knex } from 'knex'
import { db } from '@/config/db'

export async function getWhatsappConnectionForAgency(agencyId: number) {
  return db('whatsapp_connections').where({ agency_id: agencyId }).first()
}

export async function deleteWhatsappConnectionsForAgency(agencyId: number) {
  return db('whatsapp_connections').where({ agency_id: agencyId }).delete()
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
