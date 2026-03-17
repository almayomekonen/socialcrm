import { PRDCT_TYPES } from '@/types/lists'
import { omit } from '@/lib/funcs'

export async function insertSaleUsers(trx, saleId, users, cmsnRes, cntrctRes) {
  const res = []
  res.push({
    userId: users.userId,
    prcnt: users.userPrcnt || 100,
    ...cmsnRes.user,
    ...cntrctRes.user,
    saleId,
  })

  if (users.user2Id) {
    res.push({
      userId: users.user2Id,
      ...cmsnRes.user2,
      ...cntrctRes.user2,
      prcnt: users.user2Prcnt || 0,
      saleId,
    })
  }

  return await trx('sale_users').insert(res)
}

export function formatSaleAmountType(prdcts) {
  const res = []
  for (const prdct of prdcts) {
    if (prdct.amount) {
      res.push(prdct)
      continue
    }

    for (const prdctType of PRDCT_TYPES) {
      if (prdct[prdctType]) {
        const tmp = {
          ...prdct,
          amount: prdct[prdctType],
          prdctType,
        } as any
        omit(tmp, PRDCT_TYPES)
        res.push(tmp)
      }
    }
  }

  return res
}
