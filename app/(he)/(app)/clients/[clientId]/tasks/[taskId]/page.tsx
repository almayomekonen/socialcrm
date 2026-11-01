import TaskNotes from '@/components/tasks/TaskNotes'
import TaskHeader from '@/components/tasks/TaskHeader'
import { getUser } from '@/db/auth'
import { TaskPageEvents } from '@/components/tasks/utils'
import { getTaskById } from '@/db/tasks'
import { getPerms } from '@/db/filter'
import { isMobileWorkspaceRequest } from '@/lib/device'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { Metadata } from 'next'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'

/** Tab title in the interface language — Hebrew ('נתוני ליד', the lead layout's title) outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leadDetail.page.title'), description: t('leadDetail.page.description') }
}

export default async function TaskPage({ params }) {
  const { taskId } = await params

  /**
   * DESKTOP-ONLY LEAD TAB — the detail route carries the same gate as its list,
   * so a direct URL is not a way around the handoff.
   */
  const viewer = await getUser()
  if (await isMobileWorkspaceRequest(viewer?.agencyId)) return <MobileDesktopOnly section='lead_tasks' />

  const task = await getTaskById(taskId)

  const user = await getUser()
  const { allPermUsers } = await getPerms(user)

  if (!task) return null
  if (!Array.isArray(task.notes)) task.notes = []
  const { locale } = await getUiLocaleState(user)

  return (
    <div className='paper my-4 p-6' {...regionAttrs(locale)}>
      <TaskHeader task={task} users={allPermUsers} />
      <TaskNotes task={task} userName={user?.name ?? ''} translated />
      <TaskPageEvents task={task} />
    </div>
  )
}
