import TaskTmpltsTable from '@/components/taskTmplts/TaskTmpltsTable'
import { getTaskTmplts } from '@/db/tasks'

export default async function TmpltsPage() {
  const tmplts = await getTaskTmplts()

  if (tmplts.length === 0) {
    return <div className='flex items-center justify-center h-64 text-gray-400'>אין תבניות עדיין</div>
  }

  return (
    <div>
      <TaskTmpltsTable props={{ data: tmplts, tblPref: {} }} />
    </div>
  )
}
