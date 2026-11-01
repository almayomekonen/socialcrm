import ClientTasksTable from '@/components/tasks/ClientTasksTable'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { getTasksTbl, getTaskTmplts } from '@/db/tasks'
import { getUser } from '@/db/auth'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { Metadata } from 'next'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
const AddTaskForm = dynamic(() => import('@/components/tasks/addTaskForm'))

/** Tab title in the interface language — Hebrew ('נתוני ליד', the lead layout's title) outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leadDetail.page.title'), description: t('leadDetail.page.description') }
}

export default async function TasksPage({ params }) {
  const { clientId } = await params

  /**
   * DESKTOP-ONLY LEAD TAB. Reachable on a phone only by typing the URL — the
   * four-tab `ClientNav` is not rendered there — but that is still reachable.
   * Returned before the task reads, so a phone runs no query and receives no
   * table (architecture-rules.md §9). `summary` keeps its mobile screen.
   */
  const user = await getUser()
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='lead_tasks' />

  // Resolved once by the same request-memoised call the (app) layout makes.
  const { locale } = await getUiLocaleState(user)
  const data = await getTasksTbl(clientId)

  const users = [...new Set(data.map((task) => task.userName).filter(Boolean))]
  const taskTmplts = await getTaskTmplts()

  return (
    <div {...regionAttrs(locale)}>
      <ClientTasksTable props={{ data, tblPref: {}, users, clientId, taskTmplts }} />
      <Suspense>
        <AddTaskForm clientId={clientId} translated />
      </Suspense>
    </div>
  )
}
