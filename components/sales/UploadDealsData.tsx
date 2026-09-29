'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { importDeals, revalidateDealImport, uploadDealData, type DealImportResult } from '@/actions/dealImport'
import type { DealImportRow, RejectedDealRow } from '@/lib/deals/importMapping'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import { proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'

type Done = Exclude<DealImportResult, { error: 'quota_exceeded' }>

/**
 * Excel import of עסקאות: choose file → parsed and validated → confirm → import
 * → result. Built from the same parts as `UploadClientData`. The file is read by
 * the server action directly; it is not uploaded or stored (FileUploader would
 * also save it to S3 as a document, which an import must not do).
 */
export default function UploadDealsData() {
  const expired = useAccessDenied()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ data: DealImportRow[]; wrong: RejectedDealRow[] } | null>(null)
  const [result, setResult] = useState<(Done & { parseRejected: RejectedDealRow[] }) | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)
  /**
   * Refresh the deals data when the importer CLOSES, not straight after the
   * import. SalesSection keys SalesTable on its data, so an immediate refresh
   * remounts the table, and with it this modal, and the result vanishes before
   * it can be read.
   */
  const changed = useRef(false)
  useEffect(
    () => () => {
      if (changed.current) void revalidateDealImport().catch(() => {})
    },
    [],
  )

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (expired) {
      return proToast({ title: 'ייבוא עסקאות זמין עם Pro', body: 'חידוש המנוי יחזיר את ייבוא העסקאות מקובץ.', source: 'deal_import' })
    }
    setBusy(true)
    setResult(null)
    try {
      const { data, wrongData, error } = await uploadDealData(file)
      if (error) return setErrMsg(error)
      if (!data.length) {
        return setResult({ imported: 0, duplicates: 0, createdLeads: 0, rejected: [], parseRejected: wrongData })
      }
      setPending({ data, wrong: wrongData })
    } catch {
      setErrMsg('לא הצלחנו לקרוא את הקובץ. ודא שזה קובץ Excel תקין ונסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm() {
    const target = pending
    setPending(null)
    if (!target) return
    setBusy(true)
    try {
      const res = await importDeals(target.data)
      if ('error' in res) return setPaywall({ current: res.current, limit: res.limit, attempted: res.attempted })
      setResult({ ...res, parseRejected: target.wrong })
      if (res.imported > 0 || res.createdLeads > 0) changed.current = true
    } catch {
      setErrMsg('ייבוא העסקאות נכשל. לא נשמרו עסקאות — נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  const rejected = result ? [...result.parseRejected, ...result.rejected].sort((a, b) => a.row - b.row) : []
  const confirmMsg = pending
    ? `נמצאו ${pending.data.length} עסקאות תקינות${pending.wrong.length ? ` ו-${pending.wrong.length} שורות לא תקינות שלא ייובאו` : ''}. לייבא את העסקאות?`
    : ''

  return (
    <div className='p-4 w-[min(32rem,80vw)]' dir='rtl'>
      <div className='mb-4 font-semibold'>
        <p>קובץ Excel (xlsx, xls)</p>
        <p className='text-sm font-normal text-gray-500'>
          שורה ראשונה: סכום, טלפון או מייל — ואפשר גם שם, סטטוס, תאריך עסקה, שם עסקה, הערות.
        </p>
      </div>

      <label className={`btn cursor-pointer w-fit ${busy ? 'opacity-50' : ''}`}>
        <Icon name='file-excel' className='size-4' />
        <p>{busy ? 'מעבד...' : 'בחירת קובץ Excel'}</p>
        <input type='file' accept='.xlsx,.xls' aria-label='בחירת קובץ עסקאות' onChange={onFile} className='hidden' disabled={busy} />
      </label>

      {result && (
        <div className='mt-4 space-y-3 text-sm'>
          <div className={`p-4 rounded-lg border ${result.imported ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`font-semibold ${result.imported ? 'text-green-800' : 'text-amber-700'}`}>
              {result.imported ? `יובאו בהצלחה ${result.imported} עסקאות` : 'לא יובאו עסקאות'}
            </p>
            <div className='mt-1 space-y-0.5 text-gray-600'>
              {result.createdLeads > 0 && <p>נוצרו {result.createdLeads} לידים חדשים</p>}
              {result.duplicates > 0 && <p className='text-blue-600'>דולגו {result.duplicates} עסקאות שכבר קיימות</p>}
              {rejected.length > 0 && <p className='text-red-600'>שורות שלא יובאו: {rejected.length}</p>}
            </div>
          </div>

          {rejected.length > 0 && (
            <div>
              <h2 className='underline mb-1 text-red-800 font-semibold'>שורות שלא יובאו</h2>
              <ul className='max-h-48 overflow-y-auto space-y-0.5'>
                {rejected.map((r, i) => (
                  <li key={i}>
                    שורה {r.row}: {r.reason}
                    {r.label ? ` (${r.label})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmPop open={!!pending} onClose={() => setPending(null)} onConfirm={onConfirm} msg={confirmMsg} confirmLbl='ייבוא עסקאות' />
      <ConfirmPop open={!!errMsg} hideCancel onClose={() => setErrMsg(null)} onConfirm={() => setErrMsg(null)} msg={errMsg ?? ''} />
      <QuotaPaywallModal state={paywall} onClose={() => setPaywall(null)} />
    </div>
  )
}
