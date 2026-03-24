'use client'

import { useState } from 'react'
import Link from 'next/link'
import FileUploader from '@/components/files/FileUploader'
import { addLeads, importLeadsFromCsv, uploadLeadData } from '@/actions/clients'

export default function UploadClientData() {
  const [clients, setClients] = useState<Record<string, any>[]>()
  const [wrongClients, setWrongClients] = useState<Record<string, any>[]>()
  const [csvResult, setCsvResult] = useState<{ inserted: number; updated: number; unchanged: number; invalid: number } | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)

  async function onChange(files: any[]) {
    const file = files[0]
    if (!file) return
    const { data, wrongData } = await uploadLeadData(file)

    setClients(data)
    setWrongClients(wrongData)
    if (data.length) await addLeads(data)
  }

  async function onCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvLoading(true)
    setCsvResult(null)
    try {
      const result = await importLeadsFromCsv(file)
      setCsvResult(result)
    } finally {
      setCsvLoading(false)
      e.target.value = ''
    }
  }

  return (
    <div className='p-4 w-fit'>
      <div className='mb-4 font-semibold'>
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
                <p className='font-semibold text-green-800 mb-2'>יובאו בהצלחה {clients.length} לידים</p>
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

      <div className='mt-8 border-t pt-6'>
        <div className='mb-4 font-semibold'>
          <p>ייבוא לידים מקובץ CSV</p>
          <p className='text-sm font-normal text-gray-500 mt-1'>עמודות נדרשות: שם, טלפון, מייל (לפחות טלפון או מייל)</p>
        </div>

        <label className='btn cursor-pointer'>
          <input type='file' accept='.csv,text/csv' onChange={onCsvChange} className='hidden' disabled={csvLoading} />
          {csvLoading ? 'מעבד...' : 'העלאת קובץ CSV'}
        </label>

        {csvResult && (
          <div className='mt-4 space-y-1 text-sm'>
            <p className='text-green-700 font-medium'>יובאו בהצלחה: {csvResult.inserted} לידים</p>
            {csvResult.updated > 0 && <p className='text-blue-600'>עודכנו: {csvResult.updated} לידים</p>}
            {csvResult.unchanged > 0 && <p className='text-gray-500'>קיימים ללא שינוי: {csvResult.unchanged}</p>}
            {csvResult.invalid > 0 && <p className='text-red-600'>שורות לא תקינות: {csvResult.invalid}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
