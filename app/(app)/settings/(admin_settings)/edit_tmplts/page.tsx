import TaskTmpltsTable from '@/components/taskTmplts/TaskTmpltsTable'
import { getTaskTmplts } from '@/db/tasks'
import { getUser } from '@/db/auth'
import { getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export default async function TmpltsPage() {
  const tmplts = await getTaskTmplts()
  const { locale } = await getUiLocaleState(await getUser())

  if (tmplts.length === 0) {
    return (
      <div className='flex items-center justify-center h-64 text-gray-400' {...regionAttrs(locale)}>
        {translatorFor(locale)('admin.taskTmplts.empty')}
      </div>
    )
  }

  return (
    <div {...regionAttrs(locale)}>
      <TaskTmpltsTable props={{ data: tmplts, tblPref: {} }} />
    </div>
  )
}
