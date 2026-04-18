'use server'

import { calculateCommission } from '@/components/sales/saleForm/funcs/calcCmsn'
import { formatSaleAmountType } from '@/components/sales/saleForm/funcs/insertSale'
import { salesData } from '@/components/sales/salesdata'
import { db } from '@/config/db'
import { omit } from '@/lib/funcs'

export async function uploadSalesData() {
  const arr = salesData
  let uploadSales = []
  let uploadUsers = []
  await db.transaction(async (trx) => {
    // Commission rules removed — calculator neutralized. Signature of calculateCommission preserved.
    const cmsnRules: any[] = []
    let clients = []
    for (const data of arr) {
      clients.push({ ...data.client, createdById: 33 })
    }
    const test = clients.find((client) => client.firstName == '')
    const clientIds = await addClientsAndGetIds(clients)

    for (let i = 0; i < arr.length; i++) {
      delete arr[i].client
      arr[i].clientId = clientIds[i]
    }

    for (const data of arr) {
      const { prdcts, users } = data
      omit(data, ['prdcts', 'client', 'users', 'saleId'])

      const flatPrdcts = formatSaleAmountType(prdcts)
      for (const prdct of flatPrdcts) {
        const tmp = {
          ...prdct,
          ...data,
          clientId: data.clientId,
          createdById: 33,
        }

        const cmsnRes = calculateCommission(tmp, cmsnRules, users)
        const sale = { rwrd: data.rwrd, cmsn: cmsnRes.cmsn, ...tmp }

        uploadSales.push(sale)

        uploadUsers.push({
          users,
          cmsnRes,
        })
      }
    }

    let ids = await trx('sales').insert(uploadSales).returning('id')
    ids = ids.map((id) => id.id)

    const uploadSaleUsers = []

    for (let i = 0; i < ids.length; i++) {
      uploadSaleUsers.push({
        saleId: ids[i],
        userId: uploadUsers[i].users.userId,
        ...uploadUsers[i].cmsnRes.user,
        prcnt: uploadUsers[i].users.userPrcnt || 100,
      })
    }
    await trx('sale_users').insert(uploadSaleUsers)
    console.log('done')
  })
}

async function addClientsAndGetIds(clients) {
  await db('clients').insert(clients).onConflict('idNum').ignore()

  const idNums = clients.map((client) => client.idNum)
  const clnts = await db('clients').select('id', 'idNum').whereIn('idNum', idNums)

  const idNumToIdMap = {}
  clnts.forEach((client) => {
    idNumToIdMap[client.idNum] = client.id
  })

  return clients.map((client) => idNumToIdMap[client.idNum])
}
