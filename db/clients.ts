import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { getAgencyId } from './agencies'
import { getPerms } from './filter'
import { filesJsonAgg } from './helpers/aggregations'
import { Lead, LeadInfo } from '@/types/db/tables'

export type LeadKey = keyof Lead | keyof LeadInfo

export async function getFullLead({ id, select }: { id: number; select?: LeadKey[] }) {
  let query = db('clients as c').join('clients_info as ci', 'c.id', 'ci.id').where('c.id', id)

  const columnsToSelect = select ? select.filter((col) => col !== 'idFiles') : ['c.*', 'ci.*']

  query.select(columnsToSelect)

  if (select?.includes('idFiles')) {
    query
      .leftJoin('files as f', db.raw('f.id = ANY(ci."idFiles")'))
      .select(
        db.raw(`
       ${filesJsonAgg} AS "idFiles"
      `),
      )
      .groupBy('c.id', 'ci.id')
  }

  const lead = await query.first()

  return lead ? { ...lead, id: id } : undefined
}

export async function getFamMembers(clientId) {
  const familyId = (await db('clients').where('id', clientId).select('familyId').first())?.familyId
  if (!familyId) return { famMembers: [], familyId: null }

  const famMembers = await db('clients')
    .where({ familyId })
    .select('id', 'name', 'idNum', 'birthDate', 'gender', 'familyStatus', 'phone', 'email', 'familyId')

  return { famMembers, familyId }
}

export async function getLeadsByRep(user) {
  const { gotPermIds } = await getPerms(user)
  const res = await db('clients').select('id', 'details').whereIn('userId', gotPermIds)
  return res
}

export async function getLeadLists(userId) {
  return await db('client_lists').where({ userId })
}

export async function getLeadsTable({ user, params, leads = false, gotPermIds }) {
  const agencyId = await getAgencyId()

  let { filter, listId, pageNum, tableLimit, clientId } = params
  const sql = db('clients')

  pageNum = Number(pageNum) || 1
  tableLimit = Number(tableLimit) || 100

  sql.where('clients.agencyId', agencyId)

  if (leads) {
    sql.where(function () {
      this.where('rank', '<=', 4).orWhereNull('rank')
    })
  } else {
    sql.where('rank', '>=', 5)
  }

  // ✅ FIX: לא להעלים לידים בלי owner
  if (gotPermIds && !isAdmin(user.role)) {
    sql.where(function () {
      this.whereIn('clients.userId', gotPermIds).orWhereNull('clients.userId')
    })
  }

  if (clientId) sql.where('clients.id', clientId)
  else if (listId) {
    const list = await db('client_lists').where({ id: listId }).first()
    sql.whereIn('clients.id', list.clientIds)
  }

  sql
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.updatedAt', 'desc')
    .limit(tableLimit)
    .offset((pageNum - 1) * tableLimit)

  return await sql
}

export async function getLeadStats() {
  const agencyId = await getAgencyId()
  const base = () => db('clients').where('agencyId', agencyId)

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [newLeads, inProgress, closedThisMonth] = await Promise.all([
    base().where('rank', 1).count('id').first(),
    base().whereBetween('rank', [2, 4]).count('id').first(),
    base().where('rank', 5).where('updatedAt', '>=', startOfMonth).count('id').first(),
  ])

  return {
    newLeads: Number(newLeads?.count || 0),
    inProgress: Number(inProgress?.count || 0),
    closedThisMonth: Number(closedThisMonth?.count || 0),
  }
}

export async function getPipelineLeads({ gotPermIds, isAdminUser }: { gotPermIds: number[]; isAdminUser: boolean }) {
  const agencyId = await getAgencyId()

  const sql = db('clients')
    .where('clients.agencyId', agencyId)
    .where(function () {
      this.where('rank', '<=', 4).orWhereNull('rank')
    })
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.rank', 'asc')
    .orderBy('clients.createdAt', 'asc') // 🔥 חזרה למצב יציב
    .limit(15) // 🔥 כמו שהיה

  // ✅ FIX: לא להעלים לידים בלי owner
  if (gotPermIds?.length && !isAdminUser) {
    sql.where(function () {
      this.whereIn('clients.userId', gotPermIds).orWhereNull('clients.userId')
    })
  }

  return sql
}

export async function getSnoozedLeads({ gotPermIds, isAdminUser }: { gotPermIds: number[]; isAdminUser: boolean }) {
  const agencyId = await getAgencyId()
  const sql = db('clients')
    .where('clients.agencyId', agencyId)
    .where('clients.snoozeUntil', '>', db.fn.now())
    .leftJoin({ handler: 'users' }, 'clients.handlerId', 'handler.id')
    .leftJoin({ creator: 'users' }, 'clients.userId', 'creator.id')
    .select('clients.*', 'handler.name as handlerName', 'creator.name as userName')
    .orderBy('clients.snoozeUntil', 'asc')
    .limit(20)

  if (gotPermIds?.length && !isAdminUser) {
    sql.where(function () {
      this.whereIn('clients.userId', gotPermIds).orWhereNull('clients.userId')
    })
  }

  return sql
}

export async function getLeadNameByIdNum(idNum) {
  const agencyId = await getAgencyId()
  const res = await db('clients').where('idNum', idNum).where('agencyId', agencyId).select('name').first()
  return res?.name
}
