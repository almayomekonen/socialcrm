import { getUser } from '@/db/auth'
import TaskTmpltHeader from '@/components/taskTmplts/TaskTmpltHeader'
import TaskTmpltStepper from '@/components/taskTmplts/TaskTmpltStepper'
import TaskNotes from '@/components/tasks/TaskNotes'
import TaskFiles from '@/components/tasks/TaskFiles'
import { getTaskTmpltById } from '@/db/tasks'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

export default async function TmpltTaskPage({ params }) {
  const { tmpltTaskId } = await params

  const taskTmplt = await getTaskTmpltById(tmpltTaskId)
  const user = await getUser()

  if (!taskTmplt) return null
  if (!Array.isArray(taskTmplt.tasks)) taskTmplt.tasks = []
  if (!Array.isArray(taskTmplt.notes)) taskTmplt.notes = []
  const { locale } = await getUiLocaleState(user)

  return (
    <div className='paper my-4' {...regionAttrs(locale)}>
      <div className='grid xl:grid-cols-3 gap-12'>
        <div className='xl:col-span-2' key={Math.random()}>
          <TaskTmpltHeader taskTmplt={taskTmplt} />
          <TaskTmpltStepper taskTmpltIdProp={taskTmplt.id} tasks={taskTmplt.tasks} />
          <TaskFiles task={taskTmplt} />
        </div>
        <div className='xl:col-span-1'>
          <TaskNotes task={taskTmplt} userName={user?.name ?? ''} type='template' translated />
        </div>
      </div>
    </div>
  )
}
