import Link from 'next/link'
import React from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import { formatLeadDate } from '@/lib/leads/leadDate'

type TaskRow = { id: number | string; title: string; dueDate?: string | Date | null }

export default function Tasks({ tasks, clientId, locale = 'he' }: { tasks: TaskRow[]; clientId: string; locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div className='xl:p-8'>
      <h1 className='text-2xl font-bold mt-4'>{t('leadDetail.tasks.title')}</h1>
      <div className='grid grid-cols-1 gap-2 my-4'>
        {tasks.map((task) => (
          <div key={task.id} className='flex items-center justify-between bg-white px-4 py-2 border rounded'>
            <h1>{task.title}</h1>
            <p>{task.dueDate ? formatLeadDate(locale, task.dueDate) : ''}</p>
          </div>
        ))}
      </div>
      <Link href={`/clients/${clientId}/tasks`} className='text-solid float-left'>
        {t('leadDetail.tasks.all')} {'>>'}
      </Link>
    </div>
  )
}
