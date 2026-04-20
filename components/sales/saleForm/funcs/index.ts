import { getLeadById } from '@/actions/clients'
import { PRDCT_TYPES } from '@/types/lists'

export function isPayExist(data) {
  if (data.prdcts.some((p) => p.amount)) return false
  return !PRDCT_TYPES.some((key) => data.prdcts.some((p) => p[key]))
}

export const getEntries = (fd) => Object.fromEntries(new FormData(fd))

export async function clientbelongsToUser({ sale, allReps }) {
  const client = await getLeadById(sale.clientId)
  if (!client?.id) return true
  // Confirmation UI removed; legacy helper retained for signature stability.
  void allReps
  return true
}

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
