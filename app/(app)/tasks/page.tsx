import { getUser } from '@/db/auth'
import { getTasks } from '@/db/tasks'
import TasksTable from '@/components/tasks/TasksTable'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getPerms } from '@/db/filter'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'

const AddTaskForm = dynamic(() => import('@/components/tasks/addTaskForm'))

export const metadata: Metadata = {
  title: 'משימות', 
  description: 'כל משימות הלידים',
}

export default async function TasksPage({ searchParams }) {
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION. `TasksTable` is a filterable desktop grid with no
   * phone presentation; returned before `getTasks` so a phone runs no query and
   * receives no table markup (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='tasks' />

  let { filter } = await searchParams
  filter = filter ? JSON.parse(filter) : {}
  if (!filter.userId) filter.userId = user.id

  const tasks = await getTasks(user, filter)
  const { gotPermUsers, gavePermUsers } = await getPerms(user)
  const users = [...gotPermUsers, ...gavePermUsers]

  return (
    <div className='flex flex-col min-h-0 h-full'>
      <TasksTable user={user} fillHeight key={Math.random()} data={tasks} users={users} filter={filter} />
      <Suspense>
        <AddTaskForm clientId={null} />
      </Suspense>
    </div>
  )
}
