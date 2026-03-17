import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { getAgencyId } from './agencies'
import { getPerms } from './filter'
import { filesJsonAgg } from './helpers/aggregations'
import { Client, ClientsInfo } from '@/types/db/tables'

export type ClientKey = keyof Client | keyof ClientsInfo

export async function getFullClient({ id, select }: { id: number; select?: ClientKey[] }) {
  let query = db('clients as c').join('clients_info as ci', 'c.id', 'ci.id').where('c.id', id)

  const columnsToSelect = select ? select.filter((col) => col !== 'idFiles') : ['c.*', 'ci.*']

  query.select(columnsToSelect)

  if (select?.includes('idFiles')) {
    query
      .leftJoin('files as f', db.raw('f.id = ANY(ci."idFiles")'))
      .select(
        db.raw(`
       ${filesJsonAgg} AS "idFiles"
      `)
      )
      .groupBy('c.id', 'ci.id')
  }

  const client = await query.first()

  return client ? { ...client, id: id } : undefined
}

export async function getFamMembers(clientId) {
  const familyId = (await db('clients').where('id', clientId).select('familyId').first())?.familyId
  if (!familyId) return { famMembers: [], familyId: null }

  const famMembers = await db('clients')
    .where({ familyId })
    .select('id', 'name', 'idNum', 'birthDate', 'gender', 'familyStatus', 'phone', 'email', 'familyId')

  return { famMembers, familyId }
}

export async function getClientsByUser(user) {
  const { gotPermIds } = await getPerms(user)

  const res = await db('clients').select('id', 'details').whereIn('userId', gotPermIds)

  return res
}

export async function getClientLists(userId) {
  return await db('client_lists').where({ userId })
}

export async function getClientsTable({ user, params, leads = false, gotPermIds }) {
  const agencyId = await getAgencyId()

  let { filter, listId, pageNum, tableLimit, clientId } = params
  const sql = db('clients')
  pageNum = Number(pageNum) || 1
  tableLimit = Number(tableLimit) || 100

  sql.where('clients.agencyId', agencyId)
  sql.where('lead', leads)

  if (gotPermIds && !isAdmin(user.role)) sql.whereIn('clients.userId', gotPermIds)

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

  const res = await sql

  return res
}

export async function getClientNameByIdNum(idNum) {
  const agencyId = await getAgencyId()
  const res = await db('clients').where('idNum', idNum).where('agencyId', agencyId).select('name').first()
  return res?.name
}
