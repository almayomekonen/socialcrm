import TaskNotes from '@/components/tasks/TaskNotes'
import TaskHeader from '@/components/tasks/TaskHeader'
import TaskStepper from '@/components/tasks/TaskStepper'
import { getUser } from '@/db/auth'
import TaskFiles from '@/components/tasks/TaskFiles'
import { TaskPageEvents } from '@/components/tasks/utils'
import { getTaskById } from '@/db/tasks'
import { getPerms } from '@/db/filter'

export default async function TaskPage({ params }) {
  const { taskId } = await params

  const task = await getTaskById(taskId)

  const user = await getUser()
  const { allPermUsers } = await getPerms(user)

  if (!Array.isArray(task?.tasks)) task.tasks = []
  if (!Array.isArray(task?.notes)) task.notes = []

  const initIndex = task.tasks.findIndex((t) => !t.isCompleted)

  return (
    <div className='paper my-4'>
      <div className='task_grid'>
        <TaskHeader task={task} users={allPermUsers} />
        <TaskStepper task={task} initIndex={initIndex} />
        <TaskFiles task={task} />

        <TaskNotes notes={task.notes} userName={user.name} />

        <div style={{ gridArea: 'events' }}></div>
      </div>

      <TaskPageEvents task={task} />
    </div>
  )
}
