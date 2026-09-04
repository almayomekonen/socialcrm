'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import FileUploader from '@/components/files/FileUploader'
import { addLeads, importLeadsFromCsv, uploadLeadData } from '@/actions/clients'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import { proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import PasteLeadsPanel from '@/components/clients/PasteLeadsPanel'
import { FIRST_RUN_COPY as C } from '@/lib/activation/firstRunCopy'

/**
 * `onImported` lets the FIRST-RUN caller take the user somewhere after a
 * successful import instead of refreshing a table in place. Optional on
 * purpose: the settings / sales / populated-table callers pass nothing and keep
 * the existing `router.refresh()` behaviour exactly.
 */
export default function UploadClientData({
  onImported,
}: {
  onImported?: (inserted: number, firstId?: number, skipped?: number) => void
}) {
  const [tab, setTab] = useState<'file' | 'paste'>('file')
  /** Importing leads consumes lead quota, so it is Pro. */
  const expired = useAccessDenied()
  const promptImport = () =>
    proToast({
      title: 'ייבוא לידים זמין עם Pro',
      body: 'חידוש המנוי יחזיר את ייבוא הלידים מקובץ.',
      source: 'lead_import',
    })

  const router = useRouter()
  const [clients, setClients] = useState<Record<string, any>[]>()
  const [wrongClients, setWrongClients] = useState<Record<string, any>[]>()
  const [csvResult, setCsvResult] = useState<{ inserted: number; updated: number; unchanged: number; invalid: number } | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)

  async function onChange(files: any[]) {
    if (expired) return promptImport()
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
      const res = await addLeads(data)
      if ((res as any)?.error === 'quota_exceeded') {
        setPaywall({ current: (res as any).current, limit: (res as any).limit, attempted: (res as any).attempted })
        return
      }
      const inserted = (res as any)?.inserted ?? data.length
      if (onImported) onImported(inserted, (res as any)?.firstId, wrongData?.length ?? 0)
      else router.refresh()
    }
  }

  async function onCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (expired) return promptImport()
    const file = e.target.files?.[0]
    if (!file) return
    setCsvLoading(true)
    setCsvResult(null)
    try {
      const result = await importLeadsFromCsv(file)
      if ((result as any)?.error === 'quota_exceeded') {
        setPaywall({ current: (result as any).current, limit: (result as any).limit, attempted: (result as any).attempted })
        if ((result as any).inserted > 0 || (result as any).updated > 0) router.refresh()
        return
      }
      setCsvResult(result as any)
      if ((result as any).inserted > 0) router.refresh()
    } finally {
      setCsvLoading(false)
      e.target.value = ''
    }
  }

  return (
    <div className='p-4 w-fit' dir='rtl'>
      {/* File / paste. Paste is a peer tab, not a hidden fallback: on a phone
          inside an in-app browser it is the only import that can complete. */}
      <div role='tablist' aria-label='דרך הייבוא' className='mb-4 flex gap-1 rounded-lg bg-gray-100 p-1'>
        {(['file', 'paste'] as const).map((t) => (
          <button
            key={t}
            type='button'
            role='tab'
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-ink shadow-sm' : 'text-gray-500 hover:text-ink'
            }`}
          >
            {t === 'file' ? C.paste.tabFile : C.paste.tabPaste}
          </button>
        ))}
      </div>

      {tab === 'paste' ? (
        <div className='w-[min(28rem,80vw)]'>
          <PasteLeadsPanel onImported={(n, id) => (onImported ? onImported(n, id, 0) : router.refresh())} />
        </div>
      ) : (
        <>
      <div className='mb-4 font-semibold'>
        {/* Rewritten with the mapper. The old text promised the OPPOSITE of what
            the importer now accepts: it demanded a national-ID column and never
            mentioned a phone. See lib/leads/importMapping.ts. */}
        <p>קובץ Excel או CSV (xlsx, xls, csv)</p>
        <p className='text-sm font-normal text-gray-500'>שורה ראשונה: שם פרטי, טלפון — ואפשר גם שם משפחה, מייל, תעודת זהות.</p>
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
            headline = { text: 'כל הלידים כבר קיימים במערכת', cls: 'text-amber-700' }
            subline = 'נראה שהקובץ כבר הועלה בעבר'
          } else if (inserted > 0 && unchanged > 0) {
            headline = { text: `נוספו ${inserted} לידים חדשים`, cls: 'text-green-700' }
            subline = `${unchanged} לידים כבר קיימים ולא שונו`
          } else if (inserted > 0 && unchanged === 0) {
            headline = { text: 'כל הלידים נוספו בהצלחה', cls: 'text-green-700' }
          } else if (inserted === 0 && unchanged === 0 && invalid > 0) {
            headline = { text: 'לא נוספו לידים', cls: 'text-amber-700' }
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
        </>
      )}
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
      <QuotaPaywallModal state={paywall} onClose={() => setPaywall(null)} />
    </div>
  )
}
