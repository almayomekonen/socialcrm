import { getFormData2 } from '@/lib/form/funcs'
import { formatRoundCurrency, omit } from '@/lib/funcs'
import { formatShortCurrency } from '@/lib/funcs'
import { Promo } from '@/types/global'

export function formatNumAndPrecent(user, promo: Promo) {
  const goals = promo?.goals?.target || []
  const prizes = promo?.goals?.prize || []
  const branches = Object.keys(goals) || []
  const goalsLength = goals[branches[0]].length

  const obj = {} as any
  promo.isPromoGrp ? (obj['צוות'] = user.צוות) : (obj['נציג'] = user.נציג)

  let i = 0
  while (i < goalsLength) {
    branches.forEach((branch) => {
      const curGoal = goals[branch][i]
      const userVal = user[branch]

      obj[`${branch} - ${prizes[i]} (${formatShortCurrency(curGoal).toString().replace('.', ',')})`] = `
       ${formatRoundCurrency(userVal)}
        (${(Math.round((userVal / curGoal) * 100) || 0) + '%'})`
    })
    i++
  }

  return obj
}

export function getPromoFormData(e) {
  const data = getFormData2(e) as any

  const transformedData = transformPromoData(data)

  omit(data, [
    'targets',
    'prize',
    'conditions',
    ...Object.keys(data).filter((k) => /^(branch|prdcts|prdctTypes|companies)\d+$/.test(k)),
  ])

  return { ...data, ...transformedData }
}

function transformPromoData(data) {
  const conditionMap = Object.entries(data).reduce((acc, [key, value]) => {
    const match = key.match(/^(branch|prdcts|prdctTypes|companies)(\d+)$/)
    if (!match) return acc

    const [, type, index] = match
    acc[index] = acc[index] || {}
    acc[index][type] = value
    return acc
  }, {})

  const conditions = Object.keys(conditionMap)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => conditionMap[key])

  const goalLength = data.prize?.length || 0
  const target = {}
  if (goalLength > 0 && data.targets) {
    conditions.forEach((condition, i) => {
      if (condition.branch) {
        const startIndex = i * goalLength
        target[condition.branch] = data.targets.slice(startIndex, startIndex + goalLength)
      }
    })
  }

  return {
    isPromoGrp: Boolean(data.isPromoGrp),
    grpIds: data.grpIds || [],
    userIds: data.userIds || [],
    goals: {
      target,
      prize: data.prize || [],
      conditions,
    },
  }
}
