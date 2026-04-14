// 'use server'

import { db } from '@/config/db'
import { getAgencyId } from './agencies'
import { requireUser } from '@/lib/requireUser'

export async function getContractById(contractId) {
  const user = await requireUser()
  const res = await db('contracts').where({ id: contractId, agencyId: user.agencyId }).first()
  return res
}

export async function getContractPrdcts(contractId) {
  const user = await requireUser()
  const contract = await db('contracts').where({ id: contractId, agencyId: user.agencyId }).first()
  if (!contract) throw new Error('Forbidden')
  const res = await db('contract_prdcts').where({ contractId }).orderBy('updatedAt', 'desc')
  return res
}

export async function getContracts(type?: 'ראשי' | 'נציג' | 'מנהל') {
  const agencyId = await getAgencyId()
  const sql = db('contracts').where('agencyId', agencyId)

  if (type) sql.where({ type })

  return await sql.orderBy('updatedAt', 'desc')
}
