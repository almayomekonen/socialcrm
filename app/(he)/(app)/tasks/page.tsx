import { getUser } from '@/db/auth'
import { getTasks } from '@/db/tasks'
import TasksTable from '@/components/tasks/TasksTable'
import { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getPerms } from '@/db/filter'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

const AddTaskForm = dynamic(() => import('@/components/tasks/addTaskForm'))

/** Tab title in the interface language — Hebrew ('משימות') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('tasks.page.title'), description: t('tasks.page.description') }
}

export default async function TasksPage({ searchParams }) {
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION. `TasksTable` is a filterable desktop grid with no
   * phone presentation; returned before `getTasks` so a phone runs no query and
   * receives no table markup (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='tasks' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  let { filter } = await searchParams
  filter = filter ? JSON.parse(filter) : {}
  if (!filter.userId) filter.userId = user.id

  const tasks = await getTasks(user, filter)
  const { gotPermUsers, gavePermUsers } = await getPerms(user)
  const users = [...gotPermUsers, ...gavePermUsers]

  return (
    <div className='flex flex-col min-h-0 h-full' {...regionAttrs(locale)}>
      <TasksTable user={user} fillHeight key={Math.random()} data={tasks} users={users} filter={filter} />
      <Suspense>
        <AddTaskForm clientId={null} translated />
      </Suspense>
    </div>
  )
}
