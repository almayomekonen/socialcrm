export function calculateCommission(sale, cmsnRules, users) {
  let cmsn = 0,
    cmsn1 = 0,
    cmsn2 = 0,
    amount1 = 0,
    amount2 = 0,
    annualValue = 0,
    annualValue1 = 0,
    annualValue2 = 0

  const prcnt1 = users.userPrcnt || 100
  const prcnt2 = users.user2Prcnt || 0

  const cmsnRate = getCmsnRate(sale, cmsnRules)

  amount1 = sale.amount * (prcnt1 / 100)
  amount2 = sale.amount * (prcnt2 / 100)

  annualValue1 = sale.prdctType.includes('חודשית') ? amount1 * 12 : amount1
  annualValue2 = sale.prdctType.includes('חודשית') ? amount2 * 12 : amount2
  annualValue = annualValue1 + annualValue2

  if (cmsnRate) {
    cmsn = annualValue * cmsnRate
    cmsn1 = cmsn * (prcnt1 / 100)
    cmsn2 = cmsn * (prcnt2 / 100)
  }

  // Return keys 'tfuca' must match the DB column name in sale_users —
  // these values are spread directly into trx('sale_users').insert()
  return {
    cmsn,
    user: { cmsn: cmsn1, amount: amount1, tfuca: annualValue1 },
    user2: { cmsn: cmsn2, amount: amount2, tfuca: annualValue2 },
  }
}

export function getCmsnRate(sale, cmsnRules) {
  if (sale.action === 'מינוי סוכן') return null

  const rule = cmsnRules.find(
    (r) =>
      r.branch === sale.branch &&
      (!r.prdctTypes?.length || r.prdctTypes?.includes(sale.prdctType)) &&
      (!r.companies?.length || r.companies?.includes(sale.company)) &&
      (!r.prdcts?.length || r.prdcts?.includes(sale.prdct)),
  )

  return rule ? rule.cmsnRate : null
}
