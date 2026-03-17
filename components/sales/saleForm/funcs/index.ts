import { getClientById, getClientSales } from '@/actions/clients'
import { delDups } from '@/lib/funcs'
import { PRDCT_TYPES } from '@/types/lists'

export function isPayExist(data) {
  if (data.prdcts.some((p) => p.amount)) return false
  return !PRDCT_TYPES.some((key) => data.prdcts.some((p) => p[key]))
}

export const getEntries = (fd) => Object.fromEntries(new FormData(fd))

export async function clientbelongsToUser({ sale, allAgents }) {
  const client = await getClientById(sale.clientId)
  if (!client?.id) return true

  if (client.userId !== Number(sale.users.userId)) {
    const createdUserName = allAgents.find((a) => a.id == client.userId)?.name

    const isConfirm = confirm(`לקוח ${client.firstName} ${client.lastName} שייך לסוכן ${createdUserName} \n האם ברצונך להמשיך?`)
    return isConfirm
  }
  return true
}

export async function hasSaleOnClient({ sale }) {
  const sales = await getClientSales(sale.clientId)
  if (sales.length == 0) return true
  const res = sales.find((s) => s.userIds?.includes(Number(sale.users.userId)))

  if (!res) {
    const branches = delDups(sales.map((s) => s.branch)).join(', ')
    const users = delDups(sales.map((s) => s.userName)).join(', ')
    const isConfirm = confirm(
      `לפני שאנחנו ממשיכים\n\nללקוח: ${sales[0].clientData}\nיש מכירות בענפים: ${branches}\n\nע"י הסוכנים: ${users}\n\nהאם להמשיך?`,
    )

    return isConfirm
  }

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
