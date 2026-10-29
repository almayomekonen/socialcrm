import AddTaskForm from './AddTaskForm'
import { getUser } from '@/db/auth'
import { getLeadsByRep } from '@/db/clients'
import { getTaskTmplts } from '@/db/tasks'

/** `translated`: see AddTaskForm — set by the lead tasks tab only. */
export default async function AddTaskFormIndex({
  clientId,
  translated = false,
}: {
  clientId: string | null
  translated?: boolean
}) {
  const taskTmplts = await getTaskTmplts()
  const user = await getUser()

  const clients = clientId ? [] : await getLeadsByRep(user)

  return <AddTaskForm clientId={clientId} taskTmplts={taskTmplts} clients={clients} user={user} translated={translated} />
}
