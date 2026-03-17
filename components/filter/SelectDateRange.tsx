import { Select } from '@/lib/form'
import { useState } from 'react'
import SelectStartEndDate from './SelectStartEndDate'

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
        options={[
          'כל התאריכים',
          'החודש הנוכחי',
          'החודש הקודם',
          'השבוע הנוכחי',
          'השבוע הקודם',
          'השנה הנוכחית',
          'השנה הקודמת',
          'מותאם אישית',
        ]}
        defaultValue={filter?.[name]}
        onChange={dateRangeChange}
        required={false}
      />
      {customeDate && <SelectStartEndDate data={filter} startName={start} endName={end} />}
    </div>
  )
}
