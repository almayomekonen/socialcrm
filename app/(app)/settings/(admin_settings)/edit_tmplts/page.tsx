import TaskTmpltsTable from '@/components/taskTmplts/TaskTmpltsTable'
import { getTaskTmplts } from '@/db/tasks'

export default async function TmpltsPage() {
  const tmplts = await getTaskTmplts()

  return (
    <div>
      <TaskTmpltsTable props={{ data: tmplts, tblPref: {} }} />
    </div>
  )
}
