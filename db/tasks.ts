import { db } from '@/config/db'
import { getAgencyId } from './agencies'
import { getPerms } from './filter'

export async function getTasks(user, filter) {
  const limit = 3
  const perms = await getPerms(user)
  // Admins get gotPermIds: [] — fall back to allPermIds so they see all tasks
  const permIds = perms.gotPermIds.length ? perms.gotPermIds : perms.allPermIds

  const totalLimit = limit * (filter.skip + 1 || 1)

  const conditions: string[] = []
  const bindings: any[] = [permIds]

  if (filter.status) {
    conditions.push(`AND t.status = ?`)
    bindings.push(filter.status)
  }
  if (filter.userId && filter.userId !== 'all') {
    conditions.push(`AND t."userId" = ?`)
    bindings.push(Number(filter.userId))
  }

  const where = conditions.join(' ')

  const res = await db.raw(
    `SELECT
    t.*,
    c.name AS "clientName",
    u.name AS "userName"
    FROM tasks t
    JOIN clients c ON t."clientId" = c.id
    LEFT JOIN users u ON t."userId" = u.id
    WHERE t."clientId" IN (
        SELECT c2.id
        FROM clients c2
        WHERE c2."createdById" = ANY(?)
    ) ${where}
    ORDER BY t."createdAt" DESC
    LIMIT ${totalLimit}
    `,
    bindings
  )
  // OFFSET ${filter.skip * limit}

  return res.rows
}

export async function getTasksByClientId(clientId) {
  const res = await db('tasks').where({ clientId }).select('id', 'title')
  return res
}

export async function get5TasksByClientId(clientId) {
  const res = await db('tasks').where('clientId', clientId).orderBy('updatedAt', 'desc').limit(5)
  return res
}

export async function getTasksTbl(clientId) {
  const res = await db('tasks')
    .where({ clientId })
    .leftJoin('users', 'tasks.userId', 'users.id')
    .select('tasks.*', 'users.name as userName')
  return res
}

export async function getTaskById(taskId) {
  const res = await db.raw(
    `
    SELECT 
      t.*,
      COALESCE(json_agg(f.*) FILTER (WHERE f.id IS NOT NULL), '[]') as files
    FROM tasks t
    LEFT JOIN files f ON f.id = ANY(t.files)
    WHERE t.id = ?
    GROUP BY t.id
  `,
    [taskId]
  )

  return res.rows[0]
}

export async function getTaskTmplts() {
  const res = await db('task_tmplts').where('agencyId', await getAgencyId())
  return res
}

export async function getTaskTmpltById(tmpltTaskId) {
  const res = await db.raw(
    `
    SELECT 
      t.*,
      COALESCE(json_agg(f.*) FILTER (WHERE f.id IS NOT NULL), '[]') as files
    FROM task_tmplts t
    LEFT JOIN files f ON f.id = ANY(t.files)
    WHERE t.id = ?
    GROUP BY t.id
  `,
    [tmpltTaskId]
  )

  return res.rows[0]
}
