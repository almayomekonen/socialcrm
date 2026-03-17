import ClientTasksTable from '@/components/tasks/ClientTasksTable'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getTasksTbl, getTaskTmplts } from '@/db/tasks'
const AddTaskForm = dynamic(() => import('@/components/tasks/addTaskForm'))

export default async function TasksPage({ params }) {
  const { clientId } = await params
  const data = await getTasksTbl(clientId)

  const users = [...new Set(data.map((task) => task.userName).filter(Boolean))]
  const taskTmplts = await getTaskTmplts()

  return (
    <div>
      <ClientTasksTable props={{ data, tblPref: {}, users, clientId, taskTmplts }} />
      <Suspense>
        <AddTaskForm clientId={clientId} />
      </Suspense>
    </div>
  )
}
