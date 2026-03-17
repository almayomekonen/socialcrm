'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { getCmsnRules } from '@/db/cmsnRules'
import { calcUsersCmsn } from '@/components/sales/saleForm/funcs/calcCmsn'
import { saleObj } from '@/types/types'
import { calcContracts } from '@/db/contracts/calc_cont'
import { formatSaleAmountType, insertSaleUsers } from '@/components/sales/saleForm/funcs/insertSale'
import { formatCurrency, omit } from '@/lib/funcs'
import { getUser } from '@/db/auth'
import { getAgencyId } from '@/db/agencies'

export async function insertSale(data: saleObj) {
  const user = await getUser()
  await db.transaction(async (trx) => {
    if (data.saleId) await db('sales').where({ id: data.saleId }).del()

    const { prdcts, users, clientId } = data

    omit(data, ['prdcts', 'client', 'users', 'saleId', 'clientId'])

    let rules = await getCmsnRules()
    const cmsnRules = rules.map((rule) => ({
      ...rule,
      cmsnRate: rule.cmsnRate / 100, // devide by 100 to get the correct cmsn rate (for 100% it will be 1 for eg)
    }))

    const flatPrdcts = formatSaleAmountType(prdcts)

    for (const prdct of flatPrdcts) {
      let sale = {
        ...prdct,
        ...data,
        clientId,
        createdById: user.id,
      }

      // add calc when contracts are implemented
      const cntrctRes = { user: {}, user2: {} } //  await calcContracts(sale, users)

      const cmsnRes = calcUsersCmsn(sale, cmsnRules, users)

      sale = { rwrd: data.rwrd, cmsn: cmsnRes.cmsn, ...sale, agencyId: await getAgencyId() }

      const saleId = (await trx('sales').insert(sale).returning('id'))?.[0].id
      await insertSaleUsers(trx, saleId, users, cmsnRes, cntrctRes)
    }
  })

  revalidatePath('/')
}

export async function isPrdctsExists(sale): Promise<any> {
  sale.prdcts = formatSaleAmountType(sale.prdcts)
  const existingPrdcts = []

  for (const p of sale.prdcts) {
    const sql = db('sales').where({ clientId: sale.clientId, prdct: p.prdct, prdctType: p.prdctType, amount: p.amount }).first()

    if (sale.saleId) sql.whereNot({ id: sale.saleId })

    const res = await sql

    if (res) existingPrdcts.push(p)
  }

  if (!existingPrdcts.length) return null

  let msg = `המוצרים הבאים כבר קיימים ללקוח:\n`
  for (const p of existingPrdcts) {
    msg += `${p.prdct}, ${p.prdctType}, בסכום ${formatCurrency(p.amount)}, בחברת ${p.company}\n`
  }
  msg += `\nהאם להמשיך?`
  return msg
}
