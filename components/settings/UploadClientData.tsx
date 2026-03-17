'use client'

import { useState } from 'react'
import Link from 'next/link'
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
            <h1 className='underline mb-1 text-green-800 font-semibold'>לידים שנשמרו בהצלחה</h1>
            {clients?.map((c, i) => (
              <div key={i} className='flex gap-2'>
                <p>{c.firstName}</p>
                <p>{c.lastName}</p>
                <p>{c.idNum}</p>
              </div>
            ))}
            {clients.length > 0 && (
              <div className='mt-4 p-4 bg-green-50 border border-green-200 rounded-lg'>
                <p className='font-semibold text-green-800 mb-2'>יובאו בהצלחה {clients.length} לידים 🎉</p>
                <Link
                  href='/leads'
                  className='inline-flex items-center gap-2 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 transition-colors'
                >
                  צפה בלידים שלך
                </Link>
              </div>
            )}
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
