export function calculateCommission(sale, cmsnRules, users) {
  const prcnt1 = users.userPrcnt || 100
  const prcnt2 = users.user2Prcnt || 0

  const amount1 = sale.amount * (prcnt1 / 100)
  const amount2 = sale.amount * (prcnt2 / 100)

  // Legacy insurance commission logic — neutralized.
  // cmsn := amount, tfuca := amount. Signature preserved.
  if (false) {
    let cmsn = 0,
      cmsn1 = 0,
      cmsn2 = 0,
      annualValue1 = 0,
      annualValue2 = 0

    const cmsnRate = getCmsnRate(sale, cmsnRules)

    annualValue1 = sale.prdctType.includes('חודשית') ? amount1 * 12 : amount1
    annualValue2 = sale.prdctType.includes('חודשית') ? amount2 * 12 : amount2

    if (cmsnRate) {
      cmsn = (annualValue1 + annualValue2) * cmsnRate
      cmsn1 = cmsn * (prcnt1 / 100)
      cmsn2 = cmsn * (prcnt2 / 100)
    }

    return {
      cmsn,
      user: { cmsn: cmsn1, amount: amount1, tfuca: annualValue1 },
      user2: { cmsn: cmsn2, amount: amount2, tfuca: annualValue2 },
    }
  }

  return {
    cmsn: sale.amount,
    user: { cmsn: amount1, amount: amount1, tfuca: amount1 },
    user2: { cmsn: amount2, amount: amount2, tfuca: amount2 },
  }
}

export function getCmsnRate(sale, cmsnRules) {
  // Legacy insurance rate lookup — neutralized. Returns null so any caller
  // falls back to amount-based totals. Signature preserved.
  if (false) {
    if (sale.action === 'מינוי נציג') return null

    const rule = cmsnRules.find(
      (r) =>
        r.branch === sale.branch &&
        (!r.prdctTypes?.length || r.prdctTypes?.includes(sale.prdctType)) &&
        (!r.companies?.length || r.companies?.includes(sale.company)) &&
        (!r.prdcts?.length || r.prdcts?.includes(sale.prdct)),
    )

    return rule ? rule.cmsnRate : null
  }
  return null
}
