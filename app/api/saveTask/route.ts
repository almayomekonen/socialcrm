// app/api/save-on-exit/route.ts

import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const task = await request.json()

  const allSubtasksCompleted = task.tasks.every((mainTask) => mainTask.subTasks.every((subTask) => subTask.isCompleted))

  const [{ title }] = await db('tasks')
    .where('id', task.id)
    .where('agencyId', user.agencyId)
    .update({
      ...task,
      tasks: JSON.stringify(task.tasks),
      notes: JSON.stringify(task.notes),
      // files: JSON.stringify(task.files),
      completed: allSubtasksCompleted,
    })
    .returning('*')

  revalidatePath(`/clients/${task.clientId}/tasks`) // /${task.id}

  return NextResponse.json({ success: true })
}
