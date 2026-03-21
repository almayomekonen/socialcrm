'use server'

import { getUser } from '@/db/auth'
import { db } from '@/config/db'
import { getAgencyId } from '@/db/agencies'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/requireUser'

export async function deleteTask(task) {
  await requireUser()
  await db('files').where({ taskId: task.id }).del()
  await db('tasks').where({ id: task.id }).del()
  redirect(`/clients/${task.clientId}/tasks`)
}

export async function updateFullTask(task) {
  await requireUser()
  const allSubtasksCompleted = task.tasks.every((mainTask) => mainTask.subTasks.every((subTask) => subTask.isCompleted))

  await db('tasks')
    .where({ id: task.id })
    .update({
      ...task,
      tasks: JSON.stringify(task.tasks),
      notes: JSON.stringify(task.notes),
      files: task.files.map((f) => f.id),
      completed: allSubtasksCompleted,
    })
}

export async function createTask(data: { clientId: number; title: string; userId: number; _system?: boolean }) {
  if (!data._system) await requireUser()
  const { _system, ...insertData } = data
  const res = await db('tasks')
    .insert({
      ...insertData,
      dueDate: new Date().toISOString().split('T')[0],
      tasks: [] as any,
      notes: [] as any,
      files: [],
    })
    .returning('id')
  return res[0].id
}

export async function addTask(clientId, user) {
  await requireUser()
  const res = await db('tasks')
    .insert({
      title: 'כתוב כותרת',
      userId: user.id,
      dueDate: new Date().toISOString().split('T')[0],
      tasks: [],
      clientId,
    })
    .returning('id')

  return res[0].id
}

export async function saveFiles(uploadFiles, isTmplt, task) {
  await requireUser()
  if (isTmplt) {
    await db('files').insert(uploadFiles)
    revalidatePath(`/settings/edit_tmplts/${task.id}`)
  } else {
    await db('files').insert(uploadFiles)
    revalidatePath(`/clients/${task.clientId}/tasks/${task.id}`)
  }
}

export async function addTaskFromTmplt(clientId, taskTmpltId) {
  const user = await getUser()
  const taskTmplt = await db('task_tmplts').where({ id: taskTmpltId }).first()
  const res = await db('tasks')
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
    const originalFiles = await db('files').whereIn('id', taskTmplt.files).select('*')

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

    const insertedFiles = await db('files').insert(newFiles).returning('id')
    const newFileIds = insertedFiles.map((f) => f.id)

    await db('tasks').where({ id: newTaskId }).update({
      files: newFileIds,
    })
  }

  return newTaskId
}

// task_tmplts

export async function addTaskTmplt() {
  await requireUser()
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

export async function deleteTaskTmplt(taskTmplt) {
  await requireUser()
  await db('task_tmplts').where({ id: taskTmplt.id }).del()
  redirect(`/settings/edit_tmplts`)
}

export async function updateFullTaskTmplt(taskTmplt) {
  await requireUser()
  const res = await db('task_tmplts')
    .where({ id: taskTmplt.id })
    .update({
      ...taskTmplt,
      tasks: JSON.stringify(taskTmplt.tasks),
      notes: JSON.stringify(taskTmplt.notes),
      files: taskTmplt.files.map((f) => f.id),
    })
}
export async function saveFilesTmplt(uploadFiles) {
  await requireUser()
  await db('files').insert(uploadFiles)
}

export async function unlinkFileFromTaskTmplt(fileId: number, taskTmpltId: number) {
  await requireUser()
  await db.raw(
    `
    UPDATE files 
    SET "tmpltIds" = array_remove("tmpltIds", ?)
    WHERE id = ?
  `,
    [taskTmpltId, fileId],
  )
}

export async function bdikatTikTkufatitTaskExistInRange(clientId, months) {
  const tasks = await db('tasks')
    .where({ clientId })
    .where('createdAt', '>=', new Date(new Date().setMonth(new Date().getMonth() - months)))
    .where('title', '=', 'בדיקת תיק תקופתית ללקוח קיים')
  return tasks.length > 0
}
