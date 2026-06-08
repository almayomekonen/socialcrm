import { db } from '@/config/db'
import { getAgencyId } from './agencies'
import { getPerms } from './filter'
import { requireUser } from '@/lib/requireUser'

export async function getTasks(user, filter) {
  const perms = await getPerms(user)

  const permIds = perms.gotPermIds.length ? perms.gotPermIds : perms.allPermIds

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
    LIMIT 200
    `,
    bindings,
  )

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
  const user = await requireUser()
  const res = await db.raw(
    `
    SELECT
      t.*,
      COALESCE(json_agg(f.*) FILTER (WHERE f.id IS NOT NULL), '[]') as files
    FROM tasks t
    JOIN clients c ON c.id = t."clientId"
    LEFT JOIN files f ON f.id = ANY(t.files)
    WHERE t.id = ? AND c."agencyId" = ?
    GROUP BY t.id
  `,
    [taskId, user.agencyId],
  )

  return res.rows[0]
}

export async function getTaskTmplts() {
  const res = await db('task_tmplts').where('agencyId', await getAgencyId())
  return res
}

export async function getTaskTmpltById(tmpltTaskId) {
  const user = await requireUser()
  const res = await db.raw(
    `
    SELECT 
      t.*,
      COALESCE(json_agg(f.*) FILTER (WHERE f.id IS NOT NULL), '[]') as files
    FROM task_tmplts t
    LEFT JOIN files f ON f.id = ANY(t.files)
    WHERE t.id = ? AND t."agencyId" = ?
    GROUP BY t.id
  `,
    [tmpltTaskId, user.agencyId],
  )

  return res.rows[0]
}
