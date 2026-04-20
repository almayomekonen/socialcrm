import { SelectSearch } from '@/lib/form/SelectSearch'

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

export default function SelectTasksStatus({ defaultValue, onChange }: { defaultValue: string; onChange?: (e: any) => void }) {
  return (
    <SelectSearch
      lbl='סטטוס'
      name='status'
      options={statusOptions}
      selected={defaultValue}
      className='w-52'
      onSelectOpt={(status) => onChange?.(status.name)}
    />
  )
}
