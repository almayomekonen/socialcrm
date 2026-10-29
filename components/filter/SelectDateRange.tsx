import { Select } from '@/lib/form'
import { useState } from 'react'
import SelectStartEndDate from './SelectStartEndDate'
import { useT } from '@/lib/i18n/I18nProvider'
import { dateRangeLabel, labelledOptions } from '@/lib/deals/labels'

/** The STORED presets (lib/dates `getDateRange` reads these values); only their text is labelled. */
const RANGES = [
  'כל התאריכים',
  'החודש הנוכחי',
  'החודש הקודם',
  'השבוע הנוכחי',
  'השבוע הקודם',
  'השנה הנוכחית',
  'השנה הקודמת',
  'מותאם אישית',
]

export default function SelectDateRange({
  filter,
  name,
  start,
  end,
  className = '',
  lbl = '',
}: {
  filter?: any
  name?: string
  start?: string
  end?: string
  className?: string
  lbl?: string
}) {
  const t = useT()
  const [customeDate, setCustomeDate] = useState(filter[name] === 'מותאם אישית')

  function dateRangeChange(e) {
    const val = e.target.value
    val === 'מותאם אישית' ? setCustomeDate(true) : setCustomeDate(false)
  }

  return (
    <div className={className}>
      <Select
        name={name}
        lbl={lbl}
        options={labelledOptions(RANGES, dateRangeLabel, t.locale)}
        defaultValue={filter?.[name]}
        onChange={dateRangeChange}
        required={false}
      />
      {customeDate && <SelectStartEndDate data={filter} startName={start} endName={end} />}
    </div>
  )
}
