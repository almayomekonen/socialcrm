'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addLeads, importLeadsFromCsv, uploadLeadData } from '@/actions/clients'
import type { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import BottomSheet from '@/components/mobile/BottomSheet'
import QuotaPaywallMobile from './QuotaPaywallMobile'
import PasteLeadsPanel from '@/components/clients/PasteLeadsPanel'
import { FIRST_RUN_COPY as C } from '@/lib/activation/firstRunCopy'

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'

type ExcelPreview = {
  valid: Record<string, any>[]
  invalid: Record<string, any>[]
}

type CsvResult = { inserted: number; updated: number; unchanged: number; invalid: number }

function fileKind(file: File): 'excel' | 'csv' | null {
  const n = file.name.toLowerCase()
  if (n.endsWith('.csv')) return 'csv'
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel'
  if (file.type.includes('csv')) return 'csv'
  if (file.type.includes('excel') || file.type.includes('spreadsheet')) return 'excel'
  return null
}

function rowLabel(row: Record<string, any>) {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ')
  return name || 'שורה לא תקינה'
}

/**
 * Phone lead import. Same parsers and writers as desktop `UploadClientData`
 * (`uploadLeadData` + `addLeads`, `importLeadsFromCsv`) — a native file picker
 * and a stacked summary instead of the desktop grid / S3 uploader.
 */
export default function LeadImportMobile({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  /** First-run passes this to route into the imported leads; others refresh. */
  onImported?: (inserted: number, firstId?: number) => void
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'file' | 'paste'>('file')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [excel, setExcel] = useState<ExcelPreview | null>(null)
  const [csv, setCsv] = useState<CsvResult | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)

  function reset() {
    setErrMsg(null)
    setExcel(null)
    setCsv(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setErrMsg(null)
    setExcel(null)
    setCsv(null)

    const kind = fileKind(file)
    if (!kind) {
      setErrMsg('יש לבחור קובץ Excel או CSV')
      e.target.value = ''
      return
    }

    setBusy(true)
    try {
      if (kind === 'csv') {
        const result = await importLeadsFromCsv(file)
        if ((result as any)?.error === 'quota_exceeded') {
          setPaywall({ current: (result as any).current, limit: (result as any).limit, attempted: (result as any).attempted })
          if ((result as any).inserted > 0 || (result as any).updated > 0) router.refresh()
          return
        }
        setCsv(result as CsvResult)
        if ((result as CsvResult).inserted > 0) router.refresh()
        return
      }

      const { data, wrongData, error } = await uploadLeadData(file)
      if (error) {
        setErrMsg(String(error))
        return
      }
      setExcel({ valid: data ?? [], invalid: wrongData ?? [] })
    } catch {
      setErrMsg('לא הצלחנו לקרוא את הקובץ')
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  async function confirmExcel() {
    if (!excel?.valid.length) return
    setBusy(true)
    setErrMsg(null)
    try {
      const res = await addLeads(excel.valid)
      if ((res as any)?.error === 'quota_exceeded') {
        setPaywall({ current: (res as any).current, limit: (res as any).limit, attempted: (res as any).attempted })
        return
      }
      const inserted = (res as any)?.inserted ?? excel.valid.length
      onClose()
      reset()
      if (onImported) onImported(inserted, (res as any)?.firstId)
      else router.refresh()
    } catch {
      setErrMsg('לא הצלחנו לייבא את הלידים')
    } finally {
      setBusy(false)
    }
  }

  const found = excel ? excel.valid.length + excel.invalid.length : 0

  return (
    <>
      <BottomSheet
        open={open}
        onClose={() => {
          reset()
          onClose()
        }}
        title='ייבוא לידים'
        titleId='lead-import-mobile-title'
        dismissOnScrim={false}
      >
        <div role='tablist' aria-label='דרך הייבוא' className='mb-3 flex gap-1 rounded-lg bg-gray-100 p-1'>
          {(['file', 'paste'] as const).map((t) => (
            <button
              key={t}
              type='button'
              role='tab'
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'bg-white text-ink shadow-sm' : 'text-gray-500'
              }`}
            >
              {t === 'file' ? C.paste.tabFile : C.paste.tabPaste}
            </button>
          ))}
        </div>

        {tab === 'paste' ? (
          <PasteLeadsPanel
            onImported={(n, id) => {
              onClose()
              reset()
              if (onImported) onImported(n, id)
              else router.refresh()
            }}
          />
        ) : (
        <>
        <p className='text-sm leading-relaxed text-gray-600'>
          שורה ראשונה: שם פרטי, טלפון. אפשר גם שם משפחה, מייל, תעודת זהות.
        </p>

        <input
          ref={inputRef}
          type='file'
          accept={ACCEPT}
          className='sr-only'
          aria-label='בחירת קובץ לידים'
          disabled={busy}
          onChange={onPick}
        />
        <button
          type='button'
          disabled={busy}
          className='press mt-4 flex min-h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'מעבד...' : 'בחירת קובץ'}
        </button>

        {errMsg && (
          <p role='alert' className='mt-3 text-sm text-red-600'>
            {errMsg}
          </p>
        )}

        {excel && (
          <div className='mt-5 flex flex-col gap-3'>
            <p className='text-base font-semibold text-ink'>{`מצאנו ${found} לידים`}</p>
            <p className='text-sm text-gray-700'>{`${excel.valid.length} תקינים`}</p>
            <p className='text-sm text-gray-700'>{`${excel.invalid.length} דורשים בדיקה`}</p>
            {excel.invalid.length > 0 && (
              <ul className='flex flex-col divide-y divide-gray-100 rounded-lg border border-gray-200'>
                {excel.invalid.slice(0, 30).map((row, i) => (
                  <li key={i} className='px-3 py-2'>
                    <p className='text-sm font-medium text-ink'>{rowLabel(row)}</p>
                    {row.idNum != null && row.idNum !== '' && (
                      <p className='text-xs text-gray-500'>{String(row.idNum)}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button
              type='button'
              disabled={busy || excel.valid.length === 0}
              className='press flex min-h-12 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              onClick={confirmExcel}
            >
              {excel.valid.length ? `ייבא ${excel.valid.length} לידים` : 'אין לידים לייבוא'}
            </button>
          </div>
        )}

        {csv && <CsvSummary result={csv} />}
        </>
        )}
      </BottomSheet>
      <QuotaPaywallMobile state={paywall} onClose={() => setPaywall(null)} />
    </>
  )
}

function CsvSummary({ result }: { result: CsvResult }) {
  const { inserted, updated, unchanged, invalid } = result
  let headline = 'לא נוספו לידים'
  if (inserted === 0 && unchanged > 0) headline = 'כל הלידים כבר קיימים במערכת'
  else if (inserted > 0 && unchanged > 0) headline = `נוספו ${inserted} לידים חדשים`
  else if (inserted > 0) headline = 'כל הלידים נוספו בהצלחה'

  return (
    <div className='mt-5 flex flex-col gap-1.5 text-sm'>
      <p className='font-semibold text-ink'>{headline}</p>
      {unchanged > 0 && inserted > 0 && <p className='text-gray-600'>{`${unchanged} לידים כבר קיימים ולא שונו`}</p>}
      {updated > 0 && <p className='text-gray-600'>{`עודכנו פרטים ב-${updated} לידים קיימים`}</p>}
      {invalid > 0 && <p className='text-gray-600'>{`שורות לא תקינות: ${invalid}`}</p>}
    </div>
  )
}
