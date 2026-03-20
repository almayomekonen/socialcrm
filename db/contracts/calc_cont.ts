import { db } from '@/config/db'
import { getAnnualValue, getTotalAnnualValue } from './tfuca'
import { roundOrZero } from '@/lib/funcs'
import { CalcContResType } from '@/types/global'

export async function calcContracts(sale, users): Promise<CalcContResType> {
  const annualValue = getAnnualValue(sale)
  const { branch, amount } = sale
  const totalAnnualValue = ['סיכונים', 'פיננסי', 'פנסיוני'].includes(branch) ? await getTotalAnnualValue(branch, null) : 0

  if (users.user2Id && users.user2Prcnt > 0) {
    const { annualValue1, annualValue2 } = getUsersAnnualValue(annualValue, users)
    const amount1 = amount * (users.userPrcnt / 100)

    const res = await calcSingleContract({ ...sale, amount: amount1 }, annualValue1, branch, totalAnnualValue, users.userId)
    const res2 = await calcSingleContract(
      { ...sale, amount: amount - amount1 },
      annualValue2,
      branch,
      totalAnnualValue,
      users.user2Id,
    )

    return {
      user: res.user,
      user2: res2.user,
    }
  }

  // only one user
  return await calcSingleContract(sale, annualValue, branch, totalAnnualValue, users.userId)
}

async function calcSingleContract(sale, annualValue, branch, totalAnnualValue, userId) {
  const { userCntrct, mngrCntrct, agencyCntrct } = await getUserCntrct(userId)

  const userTotalAnnualValue = ['סיכונים', 'פיננסי', 'פנסיוני'].includes(branch) ? await getTotalAnnualValue(branch, userId) : 0

  const userMonthlyPrcnt = await getPrcnt(sale, userCntrct?.id)
  const userYearlyPrcnt = await getPrcnt(sale, userCntrct?.id, userTotalAnnualValue)

  const monthlyPrcnt = await getPrcnt(sale, agencyCntrct?.id)
  const yearlyPrcnt = await getPrcnt(sale, agencyCntrct?.id, totalAnnualValue)

  const monthlyCmsn = roundOrZero(userMonthlyPrcnt * annualValue.monthly)
  const yearlyCmsn = roundOrZero(userYearlyPrcnt * annualValue.yearly)

  if (mngrCntrct) {
    const mngrMonthlyPrcnt = await getPrcnt(sale, mngrCntrct?.id)
    const mngrYearlyPrcnt = await getPrcnt(sale, mngrCntrct?.id, 0)

    console.log('mngrMonthlyPrcnt', mngrMonthlyPrcnt)
    console.log('mngrYearlyPrcnt', mngrYearlyPrcnt)

    const mngrMonthlyCmsn = roundOrZero(mngrMonthlyPrcnt * annualValue.monthly)
    const mngrYearlyCmsn = roundOrZero(mngrYearlyPrcnt * annualValue.yearly)

    const agencyMonthlyCmsn = roundOrZero((monthlyPrcnt - mngrMonthlyPrcnt - userMonthlyPrcnt) * annualValue.monthly)
    const agencyYearlyCmsn = roundOrZero((yearlyPrcnt - mngrYearlyPrcnt - userYearlyPrcnt) * annualValue.yearly)

    return {
      user: { monthlyCmsn, yearlyCmsn, mngrMonthlyCmsn, mngrYearlyCmsn, agencyMonthlyCmsn, agencyYearlyCmsn },
    }
  }

  const agencyMonthlyCmsn = roundOrZero((monthlyPrcnt - userMonthlyPrcnt) * annualValue.monthly)
  const agencyYearlyCmsn = roundOrZero((yearlyPrcnt - userYearlyPrcnt) * annualValue.yearly)

  return { user: { monthlyCmsn, yearlyCmsn, agencyMonthlyCmsn, agencyYearlyCmsn } }
}

async function getUserCntrct(userId) {
  const contracts = await db('contracts').whereRaw(`${userId} = ANY("userIds")`)
  return {
    userCntrct: contracts.find((contract) => contract.type === 'נציג'),
    mngrCntrct: contracts.find((contract) => contract.type === 'מנהל'),
    agencyCntrct: contracts.find((contract) => contract.type === 'ראשי'),
  }
}

function getUsersAnnualValue(annualValue, users) {
  const multiplier = users.userPrcnt / 100
  const annualValue1 = {
    monthly: annualValue.monthly * multiplier,
    yearly: annualValue.yearly * multiplier,
  }
  const annualValue2 = {
    monthly: annualValue.monthly * (1 - multiplier),
    yearly: annualValue.yearly * (1 - multiplier),
  }
  return { annualValue1, annualValue2 }
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
