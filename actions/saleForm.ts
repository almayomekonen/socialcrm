'use server'

import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { calculateCommission } from '@/components/sales/saleForm/funcs/calcCmsn'
import { saleObj } from '@/types/types'
import { formatSaleAmountType, insertSaleUsers } from '@/components/sales/saleForm/funcs/insertSale'
import { formatCurrency, omit } from '@/lib/funcs'
import { getAgencyId } from '@/db/agencies'
import { requireProductAccess } from '@/lib/requireUser'
import { emitLeadStatusChanged } from '@/lib/automations/statusChanged'
import { leadDisplayName } from '@/lib/notifications/leadName'

/** The status a closed deal puts the lead in. Matches the catalog vocabulary. */
const CLOSED_STATUS = 'closed'

export async function insertSale(data: saleObj) {
  const user = await requireProductAccess()
  // One timestamp for the whole action, so the status change, the row's
  // `statusChangedAt` and the event's `occurredAt` are the same moment.
  const now = new Date()
  await db.transaction(async (trx) => {
    if (data.saleId) await trx('sales').where({ id: data.saleId, agencyId: user.agencyId }).del()

    const { prdcts, users, clientId } = data

    omit(data, ['prdcts', 'client', 'users', 'saleId', 'clientId'])

    const cmsnRules: any[] = []

    const flatPrdcts = formatSaleAmountType(prdcts)

    for (const prdct of flatPrdcts) {
      let sale = {
        ...prdct,
        ...data,
        clientId,
        createdById: user.id,
      }

      const cntrctRes = { user: {}, user2: {} }

      const cmsnRes = calculateCommission(sale, cmsnRules, users)

      sale = { rwrd: data.rwrd, cmsn: cmsnRes.cmsn, ...sale, agencyId: user.agencyId }

      const saleId = (await trx('sales').insert(sale).returning('id'))?.[0].id
      await insertSaleUsers(trx, saleId, users, cmsnRes, cntrctRes)
    }

    if (clientId) {
      /**
       * Close Deal is THE business action that closes a deal, so the lead's
       * status must say so.
       *
       * It previously wrote only `lead: false` — the flag that moves the record
       * from Leads to Customers — and left `status` untouched. Two consequences,
       * both fixed here: the row could sit under Customers still reading
       * `contacted`, and an automation listening for "status changed → closed"
       * never fired for the one action that actually closes deals.
       *
       * Only written when the lead is not already closed, so re-saving an
       * existing sale does not manufacture a second status change. `lead: false`
       * is applied unconditionally, exactly as before — the customer transfer
       * behaviour is unchanged.
       */
      // firstName/lastName join the existing read purely so the notification can
      // name the lead; two more columns on a row already being fetched, and no
      // caller sees this local shape.
      const before = (await trx('clients')
        .select('status', 'firstName', 'lastName')
        .where({ id: clientId, agencyId: user.agencyId })
        .first()) as { status: string | null; firstName: string | null; lastName: string | null } | undefined

      const closing = !!before && before.status !== CLOSED_STATUS
      const patch: Record<string, unknown> = { lead: false, updatedAt: now }
      if (closing) {
        // The same three fields updateLead writes with a status change, so every
        // downstream reader (follow-ups, worklist, briefing, AI warm cache)
        // behaves identically however the status was reached.
        patch.status = CLOSED_STATUS
        patch.statusChangedAt = now
        patch.lastActivityAt = now
      }

      await trx('clients').where({ id: clientId, agencyId: user.agencyId }).update(patch)

      /**
       * Emitted through the SHARED status emitter, inside this transaction: a
       * rolled-back sale enqueues nothing. Reusing that emitter is what makes
       * every existing and future status_changed automation apply here with no
       * further change — including the `deal_closed_thank_you` recipe, which
       * conditions on `newStatus is closed` and could never fire before.
       */
      if (closing) {
        await emitLeadStatusChanged({
          agencyId: user.agencyId,
          leadId: Number(clientId),
          newStatus: CLOSED_STATUS,
          occurredAt: now,
          // Closing a deal is the closer's own action, so they are not notified
          // about it; an admin closing someone else's lead still informs the rep.
          actorUserId: user.id,
          leadName: leadDisplayName(before),
          trx,
        })
      }
    }
  })

  revalidatePath('/deals')
  revalidatePath('/clients')
  revalidatePath('/leads')
  revalidatePath('/sum_sales')
}

export async function isPrdctsExists(sale): Promise<any> {
  await requireProductAccess()
  sale.prdcts = formatSaleAmountType(sale.prdcts)
  const existingPrdcts = []

  for (const p of sale.prdcts) {
    const sql = db('sales').where({ clientId: sale.clientId, prdct: p.prdct, prdctType: p.prdctType, amount: p.amount }).first()

    if (sale.saleId) sql.whereNot({ id: sale.saleId })

    const res = await sql

    if (res) existingPrdcts.push(p)
  }

  if (!existingPrdcts.length) return null

  let msg = `המוצרים הבאים כבר קיימים ללקוח:\n`
  for (const p of existingPrdcts) {
    msg += `${p.prdct}, ${p.prdctType}, בסכום ${formatCurrency(p.amount)}, בחברת ${p.company}\n`
  }
  msg += `\nהאם להמשיך?`
  return msg
}
