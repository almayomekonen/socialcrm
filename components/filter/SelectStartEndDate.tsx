import { Input } from '@/lib/form'
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export default function SelectStartEndDate({ data, startName, endName }) {
  const t = useT()
  const [startDate, setStartDate] = useState(data[startName])
  const [endDate, setEndDate] = useState(data[endName])

  function startDateChange(e) {
    setStartDate(e.target.value)
  }
  function endDateChange(e) {
    setEndDate(e.target.value)
  }
  return (
    <section className='grid grid-cols-2 gap-4 mt-2'>
      <Input lbl={t('deals.filter.start')} name={startName} defaultValue={startDate} max={endDate} onChange={startDateChange} type='date' />
      <Input lbl={t('deals.filter.end')} name={endName} defaultValue={endDate} min={startDate} onChange={endDateChange} type='date' />
    </section>
  )
}
