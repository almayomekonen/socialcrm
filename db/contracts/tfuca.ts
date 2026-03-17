import { db } from '@/config/db'
import { getAgencyId } from '../agencies'

const SOCIAL_CRM_BRANCHES = ['שירותים', 'מוצרים', 'קורסים', 'מנויים', 'חבילות', 'ייעוץ', 'אחר']

export async function getTotalAnnualValue(branch, userId) {
  if (!SOCIAL_CRM_BRANCHES.includes(branch)) return 0

  // Cast to any: 'tfuca' is the real DB column name; TypeScript alias is 'annualValue'
  const sql = (db('_flat_sales') as any)
    .where({ branch })
    .andWhere('agencyId', await getAgencyId())
    .sum('tfuca')
    .first()
  if (userId) sql.where({ userId })

  return (await sql)?.sum || 0
}

export function getAnnualValue(prdct) {
  const { prdctType, amount: rawAmount } = prdct
  const amount = parseFloat(rawAmount) || 0

  // Recurring: any monthly payment type
  if (prdctType.includes('חודשי')) return { monthly: amount, yearly: amount * 12 }

  // One-time: everything else
  return { monthly: 0, yearly: amount }
}
