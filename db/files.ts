import { db } from '@/config/db'
import { getAgencyId } from './agencies'

export async function getFilesByClientId(clientId) {
  const files = await getFiles({ clientName: true, taskTitle: true, creatorName: true })

  const res = files.filter((file) => file.clientId == clientId)
  return res
}

type GetFilesOptions = {
  creatorName?: boolean
  clientName?: boolean
  taskTitle?: boolean
}

export async function getFiles(opts: GetFilesOptions = { creatorName: false, clientName: false, taskTitle: false }) {
  const agencyId = await getAgencyId()

  const sql = db('files').where('files.agencyId', agencyId).select('files.*')
  if (opts.creatorName) {
    sql.leftJoin('users as creator', 'files.createdById', 'creator.id')
    sql.select('creator.name as createdByName')
  }
  if (opts.clientName) {
    sql.leftJoin('clients', 'files.clientId', 'clients.id')
    sql.select('clients.name as clientName')
  }
  if (opts.taskTitle) {
    sql.leftJoin('tasks', 'files.taskId', 'tasks.id')
    sql.select('tasks.title as taskTitle')
  }
  return await sql
}
// uncached for now
