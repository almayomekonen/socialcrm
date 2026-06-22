'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { calculateCommission } from '@/components/sales/saleForm/funcs/calcCmsn'
import { saleObj } from '@/types/types'
import { formatSaleAmountType, insertSaleUsers } from '@/components/sales/saleForm/funcs/insertSale'
import { formatCurrency, omit } from '@/lib/funcs'
import { getAgencyId } from '@/db/agencies'
import { requireUser } from '@/lib/requireUser'

export async function insertSale(data: saleObj) {
  const user = await requireUser()
  await db.transaction(async (trx) => {
    if (data.saleId) await trx('sales').where({ id: data.saleId, agencyId: user.agencyId }).del()

    const { prdcts, users, clientId } = data

    omit(data, ['prdcts', 'client', 'users', 'saleId', 'clientId'])

    const cmsnRules: any[] = []

    const flatPrdcts = formatSaleAmountType(prdcts)

    for (const prdct of flatPrdcts) {
      let sale = {
        ...prdct,
        ...data,
        clientId,
        createdById: user.id,
      }

      const cntrctRes = { user: {}, user2: {} }

      const cmsnRes = calculateCommission(sale, cmsnRules, users)

      sale = { rwrd: data.rwrd, cmsn: cmsnRes.cmsn, ...sale, agencyId: user.agencyId }

      const saleId = (await trx('sales').insert(sale).returning('id'))?.[0].id
      await insertSaleUsers(trx, saleId, users, cmsnRes, cntrctRes)
    }

    if (clientId) {
      await trx('clients')
        .where({ id: clientId, agencyId: user.agencyId })
        .update({ lead: false, updatedAt: new Date() })
    }
  })

  revalidatePath('/deals')
  revalidatePath('/clients')
  revalidatePath('/leads')
  revalidatePath('/sum_sales')
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
