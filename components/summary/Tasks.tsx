import Link from 'next/link'
import React from 'react'
import { formatDate } from '@/lib/dates'

export default function Tasks({ tasks, clientId }) {
  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold mt-4'>משימות</h1>
      <div className='grid grid-cols-1 gap-2 my-4'>
        {tasks.map((task) => (
          <div key={task.id} className='flex justify-between bg-white px-4 py-2 border rounded'>
            <h1>{task.title}</h1>
            <p>{formatDate(task.dueDate)}</p>
          </div>
        ))}
      </div>
      <Link href={`/clients/${clientId}/tasks`} className='text-solid float-left'>
        לכלל המשימות {'>>'}
      </Link>
    </div>
  )
}
