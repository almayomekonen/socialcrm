import { Input } from '@/lib/form'
import { useState } from 'react'

export default function SelectStartEndDate({ data, startName, endName }) {
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
      <Input lbl='תאריך התחלה' name={startName} defaultValue={startDate} max={endDate} onChange={startDateChange} type='date' />
      <Input lbl='תאריך סיום' name={endName} defaultValue={endDate} min={startDate} onChange={endDateChange} type='date' />
    </section>
  )
}
