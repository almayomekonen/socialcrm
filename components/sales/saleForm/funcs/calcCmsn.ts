export function calcUsersCmsn(sale, cmsnRules, users) {
  let cmsn = 0,
    cmsn1 = 0,
    cmsn2 = 0,
    amount1 = 0,
    amount2 = 0,
    tfuca = 0,
    tfuca1 = 0,
    tfuca2 = 0

  const prcnt1 = users.userPrcnt || 100
  const prcnt2 = users.user2Prcnt || 0

  const cmsnRate = getCmsnRate(sale, cmsnRules)

  amount1 = sale.amount * (prcnt1 / 100)
  amount2 = sale.amount * (prcnt2 / 100)

  tfuca1 = sale.prdctType.includes('חודשית') ? amount1 * 12 : amount1
  tfuca2 = sale.prdctType.includes('חודשית') ? amount2 * 12 : amount2
  tfuca = tfuca1 + tfuca2

  if (cmsnRate) {
    cmsn = tfuca * cmsnRate
    cmsn1 = cmsn * (prcnt1 / 100)
    cmsn2 = cmsn * (prcnt2 / 100)
  }

  return {
    cmsn,
    user: { cmsn: cmsn1, amount: amount1, tfuca: tfuca1 },
    user2: { cmsn: cmsn2, amount: amount2, tfuca: tfuca2 },
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
