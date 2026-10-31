'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addLeads, importLeadsFromCsv, uploadLeadData } from '@/actions/clients'
import type { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import BottomSheet from '@/components/mobile/BottomSheet'
import QuotaPaywallMobile from './QuotaPaywallMobile'
import PasteLeadsPanel from '@/components/clients/PasteLeadsPanel'
import { firstRunCopy } from '@/lib/activation/firstRunCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import { CsvSummary, ExcelPreviewMobile, type CsvResult, type ExcelPreview } from './LeadImportResults'

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'


function fileKind(file: File): 'excel' | 'csv' | null {
  const n = file.name.toLowerCase()
  if (n.endsWith('.csv')) return 'csv'
  if (n.endsWith('.xlsx') || n.endsWith('.xls')) return 'excel'
  if (file.type.includes('csv')) return 'csv'
  if (file.type.includes('excel') || file.type.includes('spreadsheet')) return 'excel'
  return null
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
  onImported?: (inserted: number, firstId?: number, skipped?: number) => void
}) {
  const router = useRouter()
  const t = useT()
  const C = firstRunCopy(t.locale)
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
      setErrMsg(t('leads.mobile.import.wrongType'))
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
      setErrMsg(t('leads.mobile.import.unreadable'))
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
      if (onImported) onImported(inserted, (res as any)?.firstId, excel.invalid.length)
      else router.refresh()
    } catch {
      setErrMsg(t('leads.mobile.import.failed'))
    } finally {
      setBusy(false)
    }
  }

    return (
    <>
      <BottomSheet
        open={open}
        onClose={() => {
          reset()
          onClose()
        }}
        title={t('leads.mobile.sheet.importLeads')}
        titleId='lead-import-mobile-title'
        dismissOnScrim={false}
        translated
      >
        <div role='tablist' aria-label={t('leads.upload.method')} className='mb-3 flex gap-1 rounded-lg bg-gray-100 p-1'>
          {(['file', 'paste'] as const).map((tabName) => (
            <button
              key={tabName}
              type='button'
              role='tab'
              aria-selected={tab === tabName}
              onClick={() => setTab(tabName)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === tabName ? 'bg-white text-ink shadow-sm' : 'text-gray-500'
              }`}
            >
              {tabName === 'file' ? C.paste.tabFile : C.paste.tabPaste}
            </button>
          ))}
        </div>

        {tab === 'paste' ? (
          <PasteLeadsPanel
            onImported={(n, id) => {
              onClose()
              reset()
              if (onImported) onImported(n, id, 0)
              else router.refresh()
            }}
          />
        ) : (
        <>
        <p className='text-sm leading-relaxed text-gray-600'>
          {t('leads.mobile.import.hint')}
        </p>

        <input
          ref={inputRef}
          type='file'
          accept={ACCEPT}
          className='sr-only'
          aria-label={t('leads.mobile.import.fileLabel')}
          disabled={busy}
          onChange={onPick}
        />
        <button
          type='button'
          disabled={busy}
          className='press mt-4 flex min-h-12 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          onClick={() => inputRef.current?.click()}
        >
          {busy ? t('leads.upload.processing') : t('leads.mobile.import.pick')}
        </button>

        {errMsg && (
          <p role='alert' className='mt-3 text-sm text-red-600'>
            {errMsg}
          </p>
        )}

        {excel && (
          <ExcelPreviewMobile excel={excel} busy={busy} onConfirm={confirmExcel} />
        )}

        {csv && <CsvSummary result={csv} />}
        </>
        )}
      </BottomSheet>
      <QuotaPaywallMobile state={paywall} onClose={() => setPaywall(null)} />
    </>
  )
}

