'use server'

import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireBasicCrmAccess, requireProductAccess } from '@/lib/requireUser'

type TaskUpdateInput = {
  title?: string
  status?: string
  dueDate?: string
  completed?: boolean
  notes?: any[]
  tasks?: any[]
  files?: any[]
}

function sanitizeTaskUpdate(input: any): TaskUpdateInput {
  const allowed: (keyof TaskUpdateInput)[] = ['title', 'status', 'dueDate', 'completed', 'notes', 'tasks', 'files']
  const result: any = {}
  for (const key of allowed) {
    if (key in input && input[key] !== undefined) {
      result[key] = input[key] as any
    }
  }
  return result
}

async function assertTaskAccess(taskId: number, user: { agencyId?: number }) {
  if (!user.agencyId) throw new Error('Forbidden')
  const task = await db('tasks').where('id', taskId).first()
  if (!task) throw new Error('Forbidden')
  const client = await db('clients').where('id', task.clientId).where('agencyId', user.agencyId).first()
  if (!client) throw new Error('Forbidden')
}

async function assertClientAccess(clientId: number, user: { agencyId?: number }) {
  if (!user.agencyId) throw new Error('Forbidden')
  const client = await db('clients').where('id', clientId).where('agencyId', user.agencyId).first()
  if (!client) throw new Error('Forbidden')
}

async function assertTemplateAccess(tmpltId: number, user: { agencyId?: number }) {
  if (!user.agencyId) throw new Error('Forbidden')
  const tmplt = await db('task_tmplts').where('id', tmpltId).where('agencyId', user.agencyId).first()
  if (!tmplt) throw new Error('Forbidden')
}

export async function deleteTask(task) {
  const user = await requireProductAccess()
  await assertTaskAccess(task.id, user)
  await db.transaction(async (trx) => {
    await trx('tasks').where({ id: task.id }).del()
    await trx('files').where({ taskId: task.id }).del()
  })
  redirect(`/clients/${task.clientId}/tasks`)
}

export async function updateFullTask(task) {
  const user = await requireProductAccess()
  await assertTaskAccess(task.id, user)
  const safe = sanitizeTaskUpdate(task)
  const taskList = Array.isArray(safe.tasks) ? safe.tasks : []
  const allSubtasksCompleted = taskList.every((mainTask) => mainTask.subTasks?.every((subTask) => subTask.isCompleted))

  await db('tasks')
    .where({ id: task.id })
    .update({
      ...safe,
      tasks: JSON.stringify(safe.tasks) as any,
      notes: JSON.stringify(safe.notes) as any,
      files: Array.isArray(safe.files) ? safe.files.map((f) => f.id) : [],
      completed: safe.completed ?? allSubtasksCompleted,
    })

  revalidatePath('/tasks')
  revalidatePath('/clients', 'layout')
}

// createTask is the USER-facing task-creation server action (a product
// boundary) — gated by requireProductAccess(). System/webhook task creation
// goes through lib/system/createSystemTask (session-independent), NOT here, so
// gating this can never affect inbound webhook ingestion.
export async function createTask(data: { clientId: number; title: string; userId?: number; _system?: boolean }) {
  const user = await requireProductAccess()
  await assertClientAccess(data.clientId, user)
  const res = await db('tasks')
    .insert({
      clientId: data.clientId,
      title: data.title,
      userId: user.id,
      dueDate: new Date().toISOString().split('T')[0],
      tasks: [] as any,
      notes: [] as any,
      files: [],
    } as any)
    .returning('id')
  return res[0].id
}

export async function addTask(clientId, _user: unknown, title = 'כתוב כותרת') {
  const authedUser = await requireProductAccess()
  await assertClientAccess(clientId, authedUser)
  const res = await db('tasks')
    .insert({
      title,
      clientId,
      userId: authedUser.id,
      dueDate: new Date().toISOString().split('T')[0],
      tasks: [],
    } as any)
    .returning('id')

  return res[0].id
}

export async function saveFiles(uploadFiles, isTmplt, task) {
  const user = await requireProductAccess()

  if (!Array.isArray(uploadFiles) || uploadFiles.length === 0) throw new Error('Invalid files')

  if (isTmplt) {
    await assertTemplateAccess(task.id, user)

    const safeFiles = uploadFiles.map((f) => {
      if (!f.name || !f.path) throw new Error('Invalid file')
      return {
        name: String(f.name),
        type: String(f.type ?? ''),
        size: Number(f.size ?? 0),
        path: String(f.path),
        agencyId: user.agencyId,
        createdById: user.id,
      }
    })

    await db('files').insert(safeFiles)
    revalidatePath(`/settings/edit_tmplts/${task.id}`)
  } else {
    await assertTaskAccess(task.id, user)
    await assertClientAccess(task.clientId, user)

    const safeFiles = uploadFiles.map((f) => {
      if (!f.name || !f.path) throw new Error('Invalid file')
      return {
        name: String(f.name),
        type: String(f.type ?? ''),
        size: Number(f.size ?? 0),
        path: String(f.path),
        taskId: task.id,
        clientId: task.clientId,
        agencyId: user.agencyId,
        createdById: user.id,
      }
    })

    await db('files').insert(safeFiles)
    revalidatePath(`/clients/${task.clientId}/tasks/${task.id}`)
  }
}

export async function addTaskFromTmplt(clientId, taskTmpltId) {
  const user = await requireProductAccess()
  await assertClientAccess(clientId, user)

  await assertTemplateAccess(taskTmpltId, user)
  const taskTmplt = await db('task_tmplts').where({ id: taskTmpltId }).first()

  const newTaskId = await db.transaction(async (trx) => {
    const res = await trx('tasks')
      .insert({
        title: taskTmplt.title,
        userId: user.id,
        dueDate: new Date().toISOString().split('T')[0],
        tasks: JSON.stringify(taskTmplt.tasks) as any,
        notes: JSON.stringify(taskTmplt.notes) as any,
        files: [],
        tmpltId: taskTmpltId,
        clientId,
      })
      .returning('id')

    const newTaskId = res[0].id

    if (taskTmplt.files && taskTmplt.files.length > 0) {
      const originalFiles = await trx('files').whereIn('id', taskTmplt.files).select('*')

      const newFiles = originalFiles.map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        path: file.path,
        createdById: user.id,
        createdAt: new Date(),
        taskId: newTaskId,
        clientId,
        agencyId: file.agencyId,
      }))

      const insertedFiles = await trx('files').insert(newFiles).returning('id')
      const newFileIds = insertedFiles.map((f) => f.id)

      await trx('tasks').where({ id: newTaskId }).update({ files: newFileIds })
    }

    return newTaskId
  })

  return newTaskId
}

// task_tmplts

/**
 * TIER 1. A task template is the customer's own configuration. Creating one
 * writes a row they own; it sends nothing, calls no provider and consumes no
 * quota. Agency scoping is unchanged.
 */
export async function addTaskTmplt() {
  await requireBasicCrmAccess()
  const res = await db('task_tmplts')
    .insert({
      title: 'כתוב כותרת',
      tasks: [],
      notes: [],
      agencyId: await getAgencyId(),
    })
    .returning('id')

  return res[0].id
}

/**
 * TIER 1, and still permission checked: `assertTemplateAccess` below is
 * unchanged, so a template belonging to another tenant is still unreachable.
 */
export async function deleteTaskTmplt(taskTmplt) {
  const user = await requireBasicCrmAccess()
  await assertTemplateAccess(taskTmplt.id, user)
  await db('task_tmplts').where({ id: taskTmplt.id }).del()
  redirect(`/settings/edit_tmplts`)
}

export async function updateFullTaskTmplt(taskTmplt) {
  const user = await requireProductAccess()
  await assertTemplateAccess(taskTmplt.id, user)
  await db('task_tmplts')
    .where({ id: taskTmplt.id })
    .update({
      title: taskTmplt.title,
      tasks: JSON.stringify(taskTmplt.tasks) as any,
      notes: JSON.stringify(taskTmplt.notes) as any,
      files: taskTmplt.files.map((f) => f.id),
    })
}
export async function saveFilesTmplt(uploadFiles) {
  await requireProductAccess()
  const safeFiles = uploadFiles.map((f: any) => ({
    name: String(f.name ?? ''),
    path: String(f.path ?? ''),
    size: Number(f.size ?? 0),
    type: String(f.type ?? ''),
  }))
  await db('files').insert(safeFiles)
}

export async function unlinkFileFromTaskTmplt(fileId: number, taskTmpltId: number) {
  await requireProductAccess()
  await db.raw(
    `
    UPDATE files 
    SET "tmpltIds" = array_remove("tmpltIds", ?)
    WHERE id = ?
  `,
    [taskTmpltId, fileId],
  )
}
