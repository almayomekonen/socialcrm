import { SelectSearch } from '@/lib/form/SelectSearch'

export const statusOptions = [
  'חדש',
  'הועבר לטיפול גורם חוץ',
  'לטיפול עקב שינוי נציג',
  'ליד לטיפול גורם חוץ',
  'ממתין לאישור הצעה',
  'ממתין לחתימת לקוח',
  'ממתין לשיוך נציג',
  'ממתין לפנייה ללקוח',
  'ממתין לקבלת הצעה',
  'ממתין לעדכון לקוח',
  'פתוח',
  "ריג'קט לטיפול",
  'רכש ממתין להפקדה ראשונה',
  'רכש ממתין לאישור',
  'הועבר לנציג אחר',
  'לא מעוניין',
  'לא רלוונטי',
  'לא רלוונטי - אין מענה',
  'סגורה',
  'עסקה בוטלה',
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
