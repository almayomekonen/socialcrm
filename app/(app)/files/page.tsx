import type { Metadata } from 'next'
import FilesTable from '@/components/files/FilesTable'
import { getFiles } from '@/db/files'
import React from 'react'

export const metadata: Metadata = { title: 'קבצים' }

export default async function FilesPage() {
  const files = await getFiles({ creatorName: true, clientName: true, taskTitle: true })
  let clients = files.map((file) => ({ id: file.clientId, name: file.clientName })).filter((c) => c.id && c.name) // remove null/undefined/empty

  clients = [...new Map(clients.map((c) => [c.id, c])).values()]

  return (
    <div className='flex flex-col min-h-0 h-full'>
      <FilesTable data={files} tasks={[]} clients={clients} fillHeight key={Math.random()} />
    </div>
  )
}
