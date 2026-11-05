import 'server-only'
import { db } from '@/config/db'
import { getPerms } from '@/db/filter'
import { canActOnLead, canActOnTask } from '@/lib/tasks/taskAccess'
import { isAdmin } from '@/types/roles'

/**
 * Who may read a stored file. The one rule behind /api/files/[fileId].
 *
 * `files.agencyId` is checked first and always. Inside the agency, a file follows
 * what it hangs off, using the same lead and task rules the product already has,
 * so there is no second permission model:
 *
 *   uploader or admin   always
 *   on a lead           whoever may act on that lead, and its handler
 *   on a task           whoever may act on that task, and its assignee
 *   neither             whoever has permission over the uploader (a manager, or a
 *                       colleague who granted access); images (logos, promotions) are
 *                       agency-wide; other documents only when a promotion or task
 *                       template shares them, since an Excel lead import also has no
 *                       lead and holds customer data
 */

export type FileActor = { id: number; agencyId?: number | null; role?: string | null; name?: string | null }

export type FileRow = {
  id: number
  agencyId: number
  name: string | null
  type: string | null
  path: string | null
  clientId: number | null
  taskId: number | null
  createdById: number | null
}

export async function loadFileForAgency(fileId: number, agencyId: number): Promise<FileRow | null> {
  const row = await db('files')
    .where({ id: fileId, agencyId })
    .first('id', 'agencyId', 'name', 'type', 'path', 'clientId', 'taskId', 'createdById')
  return (row as FileRow | undefined) ?? null
}

async function permittedIds(actor: FileActor): Promise<number[]> {
  return ((await getPerms(actor as never)) as { gotPermIds: number[] }).gotPermIds
}

/**
 * Lead access, plus the lead's handler (or someone with permission over them).
 * Handler can be set apart from the owner, and it is who the product notifies and
 * links to the lead, so a read must not refuse them. Reads only: the write rules stay
 * on `canActOnLead`.
 */
async function canReadLead(actor: FileActor, clientId: number): Promise<boolean> {
  if (await canActOnLead(actor, clientId)) return true
  const permitted = await permittedIds(actor)
  const lead = await db('clients').where({ id: clientId, agencyId: actor.agencyId }).whereIn('handlerId', permitted).first('id')
  return !!lead
}

/** The assignee of the task holding this file, which a notification can link them to. */
async function isOnTaskAssignedToActor(actor: FileActor, file: FileRow): Promise<boolean> {
  const task = await db('tasks as t')
    .join('clients as c', 'c.id', 't.clientId')
    .where('c.agencyId', actor.agencyId as number)
    .where('t.userId', actor.id)
    .where((q) => {
      q.whereRaw('? = ANY(t.files)', [file.id])
      if (file.taskId) q.orWhere('t.id', file.taskId)
    })
    .first('t.id')
  return !!task
}

async function sharedWithAgency(file: FileRow): Promise<boolean> {
  if (String(file.type ?? '').startsWith('image/')) return true
  const inList = (table: 'promo' | 'task_tmplts') =>
    db(table).where({ agencyId: file.agencyId }).whereRaw('? = ANY(files)', [file.id]).first('id')
  const [promo, template] = await Promise.all([inList('promo'), inList('task_tmplts')])
  return !!(promo || template)
}

const inOwnAgency = (actor: FileActor, file: FileRow) => !!actor.agencyId && file.agencyId === actor.agencyId
const isAdminActor = (actor: FileActor) => isAdmin(actor.role as Parameters<typeof isAdmin>[0])

export async function canReadFile(actor: FileActor, file: FileRow): Promise<boolean> {
  if (!inOwnAgency(actor, file)) return false
  if (isAdminActor(actor) || file.createdById === actor.id) return true
  if (file.clientId && (await canReadLead(actor, file.clientId))) return true
  if (file.taskId && (await canActOnTask(actor, file.taskId))) return true
  if (await isOnTaskAssignedToActor(actor, file)) return true
  if (file.clientId || file.taskId) return false

  if (file.createdById && (await permittedIds(actor)).includes(file.createdById)) return true
  return sharedWithAgency(file)
}

/**
 * Narrower than reading: being able to SEE a logo or a promotion image shared with the
 * agency must not let any rep remove it for everyone.
 */
export async function canDeleteFile(actor: FileActor, file: FileRow): Promise<boolean> {
  if (!inOwnAgency(actor, file)) return false
  if (isAdminActor(actor) || file.createdById === actor.id) return true
  if (file.clientId) return canActOnLead(actor, file.clientId)
  if (file.taskId) return canActOnTask(actor, file.taskId)
  return !!file.createdById && (await permittedIds(actor)).includes(file.createdById)
}
