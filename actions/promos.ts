'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { requireProductAccess } from '@/lib/requireUser'
import { isAdmin } from '@/types/roles'

// Columns the promo form legitimately writes. Blocks mass-assignment of
// identity/audit columns (id, agencyId, createdAt, updatedAt, promoGrps).
const PROMO_WRITABLE = ['title', 'desc', 'start', 'end', 'files', 'img', 'isPromoGrp', 'grpIds', 'userIds', 'goals'] as const

function pickPromo(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (data && typeof data === 'object') {
    for (const key of PROMO_WRITABLE) {
      if (key in (data as Record<string, unknown>)) out[key] = (data as Record<string, unknown>)[key]
    }
  }
  return out
}

export async function upsertPromo(promo, id) {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  const safe = pickPromo(promo)
  id
    ? await db('promo').update(safe).where({ id, agencyId: user.agencyId })
    : await db('promo').insert({ ...safe, agencyId: user.agencyId })

  revalidatePath('/deals')
}

export async function deletePromo(id) {
  const user = await requireProductAccess()
  if (!isAdmin(user.role)) throw new Error('Forbidden')
  await db('promo').where({ id, agencyId: user.agencyId }).delete()
  revalidatePath('/deals')
}
