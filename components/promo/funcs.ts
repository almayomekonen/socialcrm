import { getFormData2 } from '@/lib/form/funcs'
import { formatRoundCurrency, omit } from '@/lib/funcs'
import { formatShortCurrency } from '@/lib/funcs'
import { Promo } from '@/types/global'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { dealBranchLabel } from '@/lib/deals/labels'

/**
 * A campaign row's column KEY (`formatNumAndPrecent`): 'נציג' / 'צוות', or
 * `<branch> - <prize> (<goal>)`, where the branch is a stored value and the prize
 * is campaign data. Display only: the key itself is what Hebrew shows.
 */
export function promoColumnLabel(key: string, locale: UiLocale): string | null {
  const t = translatorFor(locale)
  if (key === 'נציג') return t('performance.promotion.column.rep')
  if (key === 'צוות') return t('performance.promotion.column.team')
  const cut = key.indexOf(' - ')
  if (cut < 0) return null
  const branch = key.slice(0, cut)
  const label = dealBranchLabel(branch, locale)
  return label === branch ? null : label + key.slice(cut)
}

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
