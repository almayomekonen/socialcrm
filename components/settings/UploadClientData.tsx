'use client'

import { useState } from 'react'
import FileUploader from '@/components/files/FileUploader'
import { addClients, uploadClientData } from '@/actions/clients'

export default function UploadClientData() {
  const [clients, setClients] = useState<Record<string, any>[]>()
  const [wrongClients, setWrongClients] = useState<Record<string, any>[]>()
  async function onChange(files: any[]) {
    const file = files[0]
    if (!file) return
    const { data, wrongData } = await uploadClientData(file)

    setClients(data)
    setWrongClients(wrongData)
    if (data.length) await addClients(data)
  }

  return (
    <div className='p-4  w-fit'>
      <div className=' mb-4 font-semibold'>
        <p>רק קובץ בפורמט excel, סיומת xlsx,xls</p>
        <p>שורה ראשונה בקובץ:</p>
        <p>שם פרטי, שם משפחה, תעודת זהות</p>
      </div>

      <FileUploader title='העלאת קובץ excel' getFiles={onChange} type='file' single />

      <div className='grid gap-8 grid-cols-2 mt-4'>
        {clients && (
          <div>
            <h1 className='underline mb-1 text-green-800 font-semibold'>לקוחות שנשמרו בהצלחה</h1>
            {clients?.map((c, i) => (
              <div key={i} className='flex gap-2'>
                <p>{c.firstName}</p>
                <p>{c.lastName}</p>
                <p>{c.idNum}</p>
              </div>
            ))}
          </div>
        )}

        {wrongClients && (
          <div>
            <h1 className='underline mb-1 text-red-800 font-semibold'>מידע לא תקין, לא נשמר</h1>
            {wrongClients?.map((c, i) => (
              <div key={i} className='flex gap-2'>
                <p>{c.firstName}</p>
                <p>{c.lastName}</p>
                <p>{c.idNum}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
