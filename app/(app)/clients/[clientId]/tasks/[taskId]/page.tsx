import TaskNotes from '@/components/tasks/TaskNotes'
import TaskHeader from '@/components/tasks/TaskHeader'
import { getUser } from '@/db/auth'
import { TaskPageEvents } from '@/components/tasks/utils'
import { getTaskById } from '@/db/tasks'
import { getPerms } from '@/db/filter'

export default async function TaskPage({ params }) {
  const { taskId } = await params

  const task = await getTaskById(taskId)

  const user = await getUser()
  const { allPermUsers } = await getPerms(user)

  if (!Array.isArray(task?.notes)) task.notes = []

  return (
    <div className='paper my-4 p-6'>
      <TaskHeader task={task} users={allPermUsers} />
      <TaskNotes task={task} userName={user.name} />
      <TaskPageEvents task={task} />
    </div>
  )
}
