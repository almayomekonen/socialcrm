import { SelectSearch } from '@/lib/form/SelectSearch'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import { taskStatusOptions } from '@/lib/tasks/taskStatus'

/** The STORED task statuses (`tasks.status`). Data: compared and saved as-is; labels come from `taskStatusLabel`. */
export const statusOptions = [
  'חדש',
  'בטיפול',
  'ממתין לתשובה',
  'הועבר לנציג אחר',
  'לא רלוונטי',
  'לא מעוניין',
  'סגורה',
  'הסתיים טיפול',
]

const HEBREW = translatorFor('he')

/**
 * `onChange` receives the STORED status value in every language. `translated`:
 * the caller's screen follows the interface language (the lead tasks tab); the
 * global /tasks filter bar is not translated yet and keeps Hebrew.
 */
export default function SelectTasksStatus({
  defaultValue,
  onChange,
  translated = false,
}: {
  defaultValue: string
  onChange?: (e: any) => void
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  return (
    <SelectSearch
      lbl={t('leadTabs.tasks.table.statusFilter')}
      name='status'
      options={taskStatusOptions(statusOptions, t.locale)}
      selected={defaultValue}
      className='w-52'
      onSelectOpt={(status) => onChange?.(status.id)}
    />
  )
}
