// 'use server'

import { db } from '@/config/db'
import { getAgencyId } from './agencies'

export async function getContractById(contractId) {
  const res = await db('contracts').where({ id: contractId }).first()
  return res
}

export async function getContractPrdcts(contractId) {
  const res = await db('contract_prdcts').where({ contractId }).orderBy('updatedAt', 'desc')
  return res
}

export async function getContracts(type?: 'ראשי' | 'סוכן' | 'מפקח') {
  const agencyId = await getAgencyId()
  const sql = db('contracts').where('agencyId', agencyId)

  if (type) sql.where({ type })

  return await sql.orderBy('updatedAt', 'desc')
}
