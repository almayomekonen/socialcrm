import { PRDCT_TYPES } from '@/types/lists'
import type { MessageKey } from '@/lib/i18n/translate'

export function isPayExist(data) {
  if (data.prdcts.some((p) => p.amount)) return false
  return !PRDCT_TYPES.some((key) => data.prdcts.some((p) => p[key]))
}

export const getEntries = (fd) => Object.fromEntries(new FormData(fd))

export async function hasSaleOnClient({ sale }) {
  // Legacy insurance validation (ענפים / סוכנים / נציגים) — neutralized.
  // Always allow; signature preserved.
  void sale
  return true
}

export function isAmountHigh(prdcts) {
  console.log('prdcts', prdcts)
  const maxAmount = 10000000

  for (const prdct of prdcts) {
    if (prdct.amount > maxAmount) return true

    for (const prdctType of PRDCT_TYPES) {
      if (prdct[prdctType] > maxAmount) return true
    }
  }

  return false
}

export function isSameUser(users) {
  return users.userId === users.user2Id
}

export function getUserDefault(curSale, user, officeGotPerm) {
  if (curSale?.userIds?.[0]) return curSale?.userIds?.[0]
  else return user.role === 'OFFICE' ? officeGotPerm[0]?.id : user?.id
}

/** The deal form's first failing check (as a message key), in the order the form has always applied them; null when the deal can be saved. */
export function saleValidationError(sale): MessageKey | null {
  if (!sale.users?.userId) return 'deals.form.error.noRep'
  if (!sale.clientId) return 'deals.form.error.noLead'
  if (isPayExist(sale)) return 'deals.form.error.noAmount'
  if (isAmountHigh(sale.prdcts)) return 'deals.form.error.tooHigh'
  if (isSameUser(sale.users)) return 'deals.form.error.sameRep'
  return null
}
