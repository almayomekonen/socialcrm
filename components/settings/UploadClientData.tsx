'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import FileUploader from '@/components/files/FileUploader'
import { addLeads, importLeadsFromCsv, uploadLeadData } from '@/actions/clients'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function UploadClientData() {
  const router = useRouter()
  const [clients, setClients] = useState<Record<string, any>[]>()
  const [wrongClients, setWrongClients] = useState<Record<string, any>[]>()
  const [csvResult, setCsvResult] = useState<{ inserted: number; updated: number; unchanged: number; invalid: number } | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onChange(files: any[]) {
    const file = files[0]
    if (!file) return
    const { data, wrongData, error } = await uploadLeadData(file)

    if (error) {
      setErrMsg(String(error))
      return
    }

    setClients(data)
    setWrongClients(wrongData)
    if (data.length) {
      await addLeads(data)
      router.refresh()
    }
  }

  async function onCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvLoading(true)
    setCsvResult(null)
    try {
      const result = await importLeadsFromCsv(file)
      setCsvResult(result)
      if (result.inserted > 0) router.refresh()
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

        {csvResult && (() => {
          const { inserted, updated, unchanged, invalid } = csvResult

          let headline: { text: string; cls: string } | null = null
          let subline: string | null = null

          if (inserted === 0 && unchanged > 0) {
            headline = { text: '⚠️ כל הלידים כבר קיימים במערכת', cls: 'text-amber-700' }
            subline = 'נראה שהקובץ כבר הועלה בעבר'
          } else if (inserted > 0 && unchanged > 0) {
            headline = { text: `✔ נוספו ${inserted} לידים חדשים`, cls: 'text-green-700' }
            subline = `⚠️ ${unchanged} לידים כבר קיימים ולא שונו`
          } else if (inserted > 0 && unchanged === 0) {
            headline = { text: '✔ כל הלידים נוספו בהצלחה', cls: 'text-green-700' }
          } else if (inserted === 0 && unchanged === 0 && invalid > 0) {
            headline = { text: '⚠️ לא נוספו לידים', cls: 'text-amber-700' }
            subline = 'בדוק שהקובץ כולל עמודת טלפון או מייל'
          }

          const canViewLeads = inserted > 0 || updated > 0

          return (
            <div className='mt-4 space-y-3 text-sm'>
              {headline && (
                <div className='space-y-0.5'>
                  <p className={`font-semibold ${headline.cls}`}>{headline.text}</p>
                  {subline && <p className='text-gray-600'>{subline}</p>}
                </div>
              )}

              <div className='space-y-0.5 text-gray-600'>
                {updated > 0 && <p className='text-blue-600'>עודכנו פרטים ב-{updated} לידים קיימים</p>}
                {invalid > 0 && <p className='text-red-600'>שורות לא תקינות: {invalid}</p>}
              </div>

              {canViewLeads && (
                <Link
                  href='/leads'
                  className='inline-flex items-center gap-2 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-green-700 transition-colors'
                >
                  צפה בלידים
                </Link>
              )}
            </div>
          )
        })()}
      </div>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </div>
  )
}
