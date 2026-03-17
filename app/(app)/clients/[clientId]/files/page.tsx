import ClientFilesTable from '@/components/files/ClientFilesTable'
import { getFilesByClientId } from '@/db/files'
import { getTasksByClientId } from '@/db/tasks'

export default async function page({ params, searchParams }) {
  searchParams = await searchParams
  const { clientId } = await params

  const tasks = await getTasksByClientId(clientId)

  const files = await getFilesByClientId(clientId)

  return (
    <div>
      <ClientFilesTable clientId={clientId} data={files} tasks={tasks} key={Math.random()} />
    </div>
  )
}
