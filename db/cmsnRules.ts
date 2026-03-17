'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { getAgencyId } from './agencies'

export async function getCmsnRules() {
  const cmsnRules = await db('cmsn_rules').where('agencyId', await getAgencyId())

  cmsnRules.sort((a, b) => {
    const specificityA = (a.prdcts?.length ? 1 : 0) + (a.prdctTypes?.length ? 1 : 0) + (a.companies?.length ? 1 : 0)
    const specificityB = (b.prdcts?.length ? 1 : 0) + (b.prdctTypes?.length ? 1 : 0) + (b.companies?.length ? 1 : 0)

    return specificityB - specificityA
  })

  return cmsnRules
}

export async function addCmsnRule(data) {
  if (data.id) await db('cmsn_rules').where({ id: data.id }).update(data)
  else await db('cmsn_rules').insert({ ...data, agencyId: await getAgencyId() })

  revalidatePath('/settings/calc_commission')
}

export async function deleteCmsnRule(id: number) {
  const cmsnRule = await db('cmsn_rules').where({ id }).del()

  revalidatePath('/settings/calc_commission')
  return cmsnRule
}
