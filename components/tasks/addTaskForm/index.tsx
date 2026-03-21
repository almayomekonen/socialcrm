import AddTaskForm from './AddTaskForm'
import { getUser } from '@/db/auth'
import { getLeadsByRep } from '@/db/clients'
import { getTaskTmplts } from '@/db/tasks'

export default async function AddTaskFormIndex({ clientId }) {
  const taskTmplts = await getTaskTmplts()
  const user = await getUser()

  const clients = clientId ? [] : await getLeadsByRep(user)

  return <AddTaskForm clientId={clientId} taskTmplts={taskTmplts} clients={clients} user={user} />
}
