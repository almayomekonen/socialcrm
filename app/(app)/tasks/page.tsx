import { getUser } from '@/db/auth'
import { getTasks } from '@/db/tasks'
import TasksTable from '@/components/tasks/TasksTable'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getPerms } from '@/db/filter'
import TaskLists from '@/components/tasks/TaskLists'

const AddTaskForm = dynamic(() => import('@/components/tasks/addTaskForm'))

export const metadata: Metadata = {
  title: 'מעקבים',
  description: 'כל מעקבי הלידים',
}

export default async function TasksPage({ searchParams }) {
  const user = await getUser()
  let { filter } = await searchParams
  filter = filter ? JSON.parse(filter) : { skip: 0 }
  filter.skip = filter.skip | 0
  if (!filter.userId) filter.userId = user.id

  const tasks = await getTasks(user, filter)
  const { gotPermUsers, gavePermUsers } = await getPerms(user)
  const users = [...gotPermUsers, ...gavePermUsers]

  return (
    <div className='mb-8'>
      <h1 className='title mb-2'>מעקבים</h1>
      <TaskLists />
      <TasksTable user={user} key={Math.random()} data={tasks} users={users} filter={filter} />
      <Suspense>
        <AddTaskForm clientId={null} />
      </Suspense>
    </div>
  )
}
