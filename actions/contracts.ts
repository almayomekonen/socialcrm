'use server'

import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'

export async function upsertCont(data: any) {
  if (data.id) {
    await db('contracts').where({ id: data.id }).update(data)
    revalidatePath(`/settings/edit_contracts/${data.id}`)
  } else {
    const res = await db('contracts')
      .insert({ ...data, agencyId: await getAgencyId() })
      .returning('id')
    revalidatePath('/settings/edit_contracts')
    return res[0]?.id
  }
}

export async function duplicateCont(data: any) {
  const { id: oldId, ...rest } = data
  rest.agencyId = await getAgencyId()
  const newContract = await db('contracts').insert(rest).returning('id')
  const newContractId = newContract[0]?.id
  // get products by old contract id
  const products = await db('contract_prdcts').where({ contractId: oldId })
  const newProducts = products.map((product) => ({ ...product, contractId: newContractId, id: undefined }))
  await db('contract_prdcts').insert(newProducts)

  revalidatePath('/settings/edit_contracts')
  return newContractId
}

export async function deleteCont(contId: number) {
  await db('contract_prdcts').where({ contractId: contId }).del()
  await db('contracts').where({ id: contId }).del()

  revalidatePath('/settings/edit_contracts')
}

export async function upsertContPrdcts(data: any) {
  if (data.id) await db('contract_prdcts').where({ id: data.id }).update(data)
  else await db('contract_prdcts').insert(data)
  revalidatePath('/settings/edit_contracts/[id]')
}

export async function deleteContPrdct(id: number) {
  await db('contract_prdcts').where({ id }).del()
  revalidatePath('/settings/edit_contracts/[id]')
}
