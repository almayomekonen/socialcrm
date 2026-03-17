import { db } from '@/config/db'
import { getTfuca, getTotalTfuca } from './tfuca'
import { roundOrZero } from '@/lib/funcs'
import { CalcContResType } from '@/types/global'

export async function calcContracts(sale, users): Promise<CalcContResType> {
  const tfuca = getTfuca(sale)
  const { branch, amount } = sale
  const totalTfuca = ['סיכונים', 'פיננסי', 'פנסיוני'].includes(branch) ? await getTotalTfuca(branch, null) : 0

  if (users.user2Id && users.user2Prcnt > 0) {
    const { tfuca1, tfuca2 } = getUsersTfuca(tfuca, users)
    const amount1 = amount * (users.userPrcnt / 100)

    const res = await calcSingleContract({ ...sale, amount: amount1 }, tfuca1, branch, totalTfuca, users.userId)
    const res2 = await calcSingleContract({ ...sale, amount: amount - amount1 }, tfuca2, branch, totalTfuca, users.user2Id)

    return {
      user: res.user,
      user2: res2.user,
    }
  }

  // only one user
  return await calcSingleContract(sale, tfuca, branch, totalTfuca, users.userId)
}

async function calcSingleContract(sale, tfuca, branch, totalTfuca, userId) {
  const { userCntrct, mngrCntrct, agencyCntrct } = await getUserCntrct(userId)

  const userTotalTfuca = ['סיכונים', 'פיננסי', 'פנסיוני'].includes(branch) ? await getTotalTfuca(branch, userId) : 0

  const userMonthlyPrcnt = await getPrcnt(sale, userCntrct?.id)
  const userYearlyPrcnt = await getPrcnt(sale, userCntrct?.id, userTotalTfuca)

  const monthlyPrcnt = await getPrcnt(sale, agencyCntrct?.id)
  const yearlyPrcnt = await getPrcnt(sale, agencyCntrct?.id, totalTfuca)

  const monthlyCmsn = roundOrZero(userMonthlyPrcnt * tfuca.monthly)
  const yearlyCmsn = roundOrZero(userYearlyPrcnt * tfuca.yearly)

  if (mngrCntrct) {
    const mngrMonthlyPrcnt = await getPrcnt(sale, mngrCntrct?.id)
    const mngrYearlyPrcnt = await getPrcnt(sale, mngrCntrct?.id, 0)

    console.log('mngrMonthlyPrcnt', mngrMonthlyPrcnt)
    console.log('mngrYearlyPrcnt', mngrYearlyPrcnt)

    const mngrMonthlyCmsn = roundOrZero(mngrMonthlyPrcnt * tfuca.monthly)
    const mngrYearlyCmsn = roundOrZero(mngrYearlyPrcnt * tfuca.yearly)

    const agencyMonthlyCmsn = roundOrZero((monthlyPrcnt - mngrMonthlyPrcnt - userMonthlyPrcnt) * tfuca.monthly)
    const agencyYearlyCmsn = roundOrZero((yearlyPrcnt - mngrYearlyPrcnt - userYearlyPrcnt) * tfuca.yearly)

    return {
      user: { monthlyCmsn, yearlyCmsn, mngrMonthlyCmsn, mngrYearlyCmsn, agencyMonthlyCmsn, agencyYearlyCmsn },
    }
  }

  const agencyMonthlyCmsn = roundOrZero((monthlyPrcnt - userMonthlyPrcnt) * tfuca.monthly)
  const agencyYearlyCmsn = roundOrZero((yearlyPrcnt - userYearlyPrcnt) * tfuca.yearly)

  return { user: { monthlyCmsn, yearlyCmsn, agencyMonthlyCmsn, agencyYearlyCmsn } }
}

async function getUserCntrct(userId) {
  const contracts = await db('contracts').whereRaw(`${userId} = ANY("userIds")`)
  return {
    userCntrct: contracts.find((contract) => contract.type === 'סוכן'),
    mngrCntrct: contracts.find((contract) => contract.type === 'מפקח'),
    agencyCntrct: contracts.find((contract) => contract.type === 'ראשי'),
  }
}

function getUsersTfuca(tfuca, users) {
  const multiplier = users.userPrcnt / 100
  const tfuca1 = {
    monthly: tfuca.monthly * multiplier,
    yearly: tfuca.yearly * multiplier,
  }
  const tfuca2 = {
    monthly: tfuca.monthly * (1 - multiplier),
    yearly: tfuca.yearly * (1 - multiplier),
  }
  return { tfuca1, tfuca2 }
}

async function getPrcnt(sale, contractId, total = null) {
  if (!contractId) return 0
  const tagmulType = total != null ? 'היקף' : 'נפרעים'

  const sql = db('contract_prdcts')
    .where({ contractId, tagmulType, branch: sale.branch })
    .where((q) => q.whereNull('prdcts').orWhere('prdcts', '@>', [sale.prdct]))
    .where((q) => q.whereNull('prdctTypes').orWhere('prdctTypes', '@>', [sale.prdctType]))
    .where((q) => q.whereNull('companies').orWhere('companies', '@>', [sale.company]))

  if (tagmulType === 'היקף') {
    sql.where('fromAmount', '<=', total).orderBy('fromAmount', 'desc')
  }

  const res = await sql.first()
  return res?.prcnt / 100 || 0
}
